//! Turf: a real-time territory war that lives entirely in one Solana account.
//!
//! The board is a 30 x 18 hex grid. Players claim hexes next to land they
//! already hold. Energy refills by one point every slot, so the pace of the
//! game is the pace of the chain. Taking an enemy hex costs more for every
//! hex of its owner that surrounds it, so solid territory holds and thin
//! lines break. When a round's slots run out, anyone can crank `next_round`,
//! which writes the winner into the arena's hall of fame and deals a fresh map.

use anchor_lang::prelude::*;

declare_id!("Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi");

pub const W: usize = 30;
pub const H: usize = 18;
pub const N: usize = W * H;
pub const MAX_PLAYERS: usize = 8;
pub const HALL: usize = 8;
pub const ENERGY_CAP: u64 = 30;
pub const START_ENERGY: u16 = 12;
pub const MAX_TARGETS: usize = 12;
/// A player who has not moved for this many slots (one to two minutes, by slot time) can be
/// replaced by a newcomer, and is dropped when the next round is dealt.
pub const IDLE_SLOTS: u64 = 300;
pub const MIN_ROUND: u32 = 150;
pub const MAX_ROUND: u32 = 9_000;

const NONE: usize = usize::MAX;

#[program]
pub mod turf {
    use super::*;

    /// Open a new arena. Anyone can open one; the creator pays its rent.
    pub fn create_arena(ctx: Context<CreateArena>, id: u32, round_slots: u32) -> Result<()> {
        require!(
            (MIN_ROUND..=MAX_ROUND).contains(&round_slots),
            TurfError::BadRoundLength
        );
        let slot = Clock::get()?.slot;
        let mut a = ctx.accounts.arena.load_init()?;
        a.creator = ctx.accounts.payer.key();
        a.id = id;
        a.round_slots = round_slots;
        a.round = 1;
        a.round_start = slot;
        a.round_end = slot + round_slots as u64;
        a.bump = ctx.bumps.arena;
        Ok(())
    }

    /// Take a seat (or respawn if you were wiped out). You land on a free
    /// patch of seven hexes, as far from everyone else as the map allows.
    pub fn join(ctx: Context<Act>, name: [u8; 15]) -> Result<()> {
        let slot = Clock::get()?.slot;
        let key = ctx.accounts.player.key();
        let mut guard = ctx.accounts.arena.load_mut()?;
        let a = &mut *guard;
        require!(slot < a.round_end, TurfError::RoundOver);

        if let Some(i) = seat_of(a, &key) {
            a.players[i].name = name;
            if a.players[i].tiles == 0 {
                regen(&mut a.players[i], slot);
                spawn(a, i, slot);
            }
            return Ok(());
        }

        let seat = match a.players.iter().position(|p| p.active == 0) {
            Some(i) => i,
            None => {
                let (i, idle) = a
                    .players
                    .iter()
                    .enumerate()
                    .map(|(i, p)| (i, slot.saturating_sub(p.last_slot)))
                    .max_by_key(|&(_, idle)| idle)
                    .unwrap();
                require!(idle > IDLE_SLOTS, TurfError::ArenaFull);
                clear_owner(&mut a.tiles, tag(i));
                i
            }
        };

        a.players[seat] = Player {
            authority: key,
            last_slot: slot,
            moves: 0,
            energy: START_ENERGY,
            tiles: 0,
            name,
            active: 1,
        };
        spawn(a, seat, slot);
        emit!(Joined {
            arena: a.id,
            seat: seat as u8,
            player: key
        });
        Ok(())
    }

    /// Claim up to 12 hexes, in order. Each must touch land you hold at the
    /// moment it is processed, so a path can be painted in one transaction.
    /// Hexes you cannot reach or afford are skipped; the rest still land.
    pub fn claim(ctx: Context<Act>, targets: Vec<u16>) -> Result<()> {
        require!(
            !targets.is_empty() && targets.len() <= MAX_TARGETS,
            TurfError::BadTargets
        );
        let slot = Clock::get()?.slot;
        let key = ctx.accounts.player.key();
        let mut guard = ctx.accounts.arena.load_mut()?;
        let a = &mut *guard;
        require!(slot < a.round_end, TurfError::RoundOver);
        let me = seat_of(a, &key).ok_or(TurfError::NotJoined)?;
        regen(&mut a.players[me], slot);
        let mine = tag(me);

        let mut taken: u16 = 0;
        for t in targets {
            let t = t as usize;
            require!(t < N, TurfError::BadTargets);
            let owner = a.tiles[t];
            if owner == mine {
                continue;
            }
            if a.players[me].tiles == 0 {
                // Wiped out players may parachute onto any neutral hex.
                if owner != 0 {
                    continue;
                }
            } else if count_owned(&a.tiles, t, mine) == 0 {
                continue;
            }
            let cost = if owner == 0 {
                1
            } else {
                2 + count_owned(&a.tiles, t, owner) as u16
            };
            if a.players[me].energy < cost {
                break;
            }
            a.players[me].energy -= cost;
            if owner != 0 {
                let o = (owner - 1) as usize;
                a.players[o].tiles = a.players[o].tiles.saturating_sub(1);
            }
            a.tiles[t] = mine;
            a.players[me].tiles += 1;
            taken += 1;
        }

        a.players[me].moves = a.players[me].moves.saturating_add(1);
        a.round_moves = a.round_moves.saturating_add(1);
        a.total_moves = a.total_moves.saturating_add(1);
        a.round_hexes = a.round_hexes.saturating_add(taken as u32);
        Ok(())
    }

    /// Close a finished round: crown the player holding the most hexes,
    /// record them in the hall of fame, drop idle players and deal a new map.
    /// Permissionless, so any client or bot can turn the crank.
    pub fn next_round(ctx: Context<Crank>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let mut guard = ctx.accounts.arena.load_mut()?;
        let a = &mut *guard;
        require!(slot >= a.round_end, TurfError::RoundNotOver);

        let mut best: Option<usize> = None;
        for i in 0..MAX_PLAYERS {
            let p = &a.players[i];
            if p.active == 1 && p.tiles > 0 && best.map_or(true, |b| p.tiles > a.players[b].tiles) {
                best = Some(i);
            }
        }
        if let Some(b) = best {
            let mut name = [0u8; 16];
            name[..15].copy_from_slice(&a.players[b].name);
            let h = (a.hall_count as usize) % HALL;
            a.hall[h] = Champion {
                authority: a.players[b].authority,
                name,
                round: a.round,
                tiles: a.players[b].tiles as u32,
            };
            a.hall_count = a.hall_count.wrapping_add(1);
            emit!(RoundWon {
                arena: a.id,
                round: a.round,
                winner: a.players[b].authority,
                tiles: a.players[b].tiles,
            });
        }

        a.tiles = [0; N];
        a.round = a.round.wrapping_add(1);
        a.round_start = slot;
        a.round_end = slot + a.round_slots as u64;
        a.round_moves = 0;
        a.round_hexes = 0;
        for i in 0..MAX_PLAYERS {
            let p = &mut a.players[i];
            if p.active == 0 {
                continue;
            }
            if slot.saturating_sub(p.last_slot) > IDLE_SLOTS {
                *p = bytemuck::Zeroable::zeroed();
                continue;
            }
            p.tiles = 0;
            p.moves = 0;
            p.energy = START_ENERGY;
            p.last_slot = slot;
        }
        for i in 0..MAX_PLAYERS {
            if a.players[i].active == 1 {
                spawn(a, i, slot);
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
#[instruction(id: u32)]
pub struct CreateArena<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + core::mem::size_of::<Arena>(),
        seeds = [b"arena", id.to_le_bytes().as_ref()],
        bump
    )]
    pub arena: AccountLoader<'info, Arena>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Act<'info> {
    #[account(mut)]
    pub arena: AccountLoader<'info, Arena>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct Crank<'info> {
    #[account(mut)]
    pub arena: AccountLoader<'info, Arena>,
}

// ---------------------------------------------------------------- state

#[account(zero_copy)]
pub struct Arena {
    pub creator: Pubkey,      // 0
    pub round_start: u64,     // 32
    pub round_end: u64,       // 40
    pub total_moves: u64,     // 48
    pub round: u32,           // 56
    pub round_slots: u32,     // 60
    pub round_moves: u32,     // 64
    pub id: u32,              // 68
    pub hall_count: u32,      // 72
    pub round_hexes: u32,     // 76
    pub bump: u8,             // 80
    pub _pad: [u8; 7],        // 81
    pub players: [Player; MAX_PLAYERS], // 88, 64 bytes each
    pub hall: [Champion; HALL],         // 600, 56 bytes each
    pub tiles: [u8; N],                 // 1048, owner seat + 1, 0 = neutral
    pub _tail: [u8; 4],                 // 1588
}

#[zero_copy]
pub struct Player {
    pub authority: Pubkey, // 0
    pub last_slot: u64,    // 32
    pub moves: u32,        // 40
    pub energy: u16,       // 44
    pub tiles: u16,        // 46
    pub name: [u8; 15],    // 48
    pub active: u8,        // 63
}

#[zero_copy]
pub struct Champion {
    pub authority: Pubkey, // 0
    pub name: [u8; 16],    // 32
    pub round: u32,        // 48
    pub tiles: u32,        // 52
}

#[event]
pub struct Joined {
    pub arena: u32,
    pub seat: u8,
    pub player: Pubkey,
}

#[event]
pub struct RoundWon {
    pub arena: u32,
    pub round: u32,
    pub winner: Pubkey,
    pub tiles: u16,
}

#[error_code]
pub enum TurfError {
    #[msg("Round length must be between 150 and 9000 slots")]
    BadRoundLength,
    #[msg("Send between 1 and 12 hexes that exist on the board")]
    BadTargets,
    #[msg("This round is over; crank next_round to deal a new map")]
    RoundOver,
    #[msg("This round is still running")]
    RoundNotOver,
    #[msg("Join the arena first")]
    NotJoined,
    #[msg("All eight seats are taken by active players")]
    ArenaFull,
}

// ---------------------------------------------------------------- board logic

#[inline]
fn tag(seat: usize) -> u8 {
    (seat + 1) as u8
}

fn seat_of(a: &Arena, key: &Pubkey) -> Option<usize> {
    a.players
        .iter()
        .position(|p| p.active == 1 && p.authority == *key)
}

fn regen(p: &mut Player, slot: u64) {
    let gained = slot.saturating_sub(p.last_slot);
    p.energy = (p.energy as u64 + gained).min(ENERGY_CAP) as u16;
    p.last_slot = slot;
}

/// Neighbours of hex `i` on an odd-r offset grid (odd rows shifted right).
pub fn neighbors(i: usize) -> [usize; 6] {
    let r = (i / W) as isize;
    let c = (i % W) as isize;
    let d: [(isize, isize); 6] = if r & 1 == 1 {
        [(-1, 0), (1, 0), (0, -1), (1, -1), (0, 1), (1, 1)]
    } else {
        [(-1, 0), (1, 0), (-1, -1), (0, -1), (-1, 1), (0, 1)]
    };
    let mut out = [NONE; 6];
    for (k, (dc, dr)) in d.iter().enumerate() {
        let (nc, nr) = (c + dc, r + dr);
        if nc >= 0 && nc < W as isize && nr >= 0 && nr < H as isize {
            out[k] = nr as usize * W + nc as usize;
        }
    }
    out
}

fn count_owned(tiles: &[u8; N], i: usize, owner: u8) -> u8 {
    neighbors(i)
        .iter()
        .filter(|&&n| n != NONE && tiles[n] == owner)
        .count() as u8
}

fn clear_owner(tiles: &mut [u8; N], owner: u8) {
    for t in tiles.iter_mut() {
        if *t == owner {
            *t = 0;
        }
    }
}

fn mix(mut x: u64) -> u64 {
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    x ^= x >> 33;
    x
}

/// Is every hex within two steps of `t` neutral (or off the board)?
fn clear_ring2(tiles: &[u8; N], t: usize) -> bool {
    for n in neighbors(t) {
        if n == NONE {
            continue;
        }
        if tiles[n] != 0 {
            return false;
        }
        for m in neighbors(n) {
            if m != NONE && tiles[m] != 0 {
                return false;
            }
        }
    }
    true
}

fn clear_ring1(tiles: &[u8; N], t: usize) -> bool {
    neighbors(t).iter().all(|&n| n == NONE || tiles[n] == 0)
}

/// Landing sites (column, row), spread so the first four seats start in the
/// four corners, then the edge midpoints, then the middle. Seat `i` tries
/// site `i` first.
const SITES: [(usize, usize); MAX_PLAYERS] = [
    (4, 4),
    (25, 13),
    (25, 4),
    (4, 13),
    (15, 2),
    (14, 15),
    (9, 9),
    (20, 8),
];

/// Drop seat `i` onto the map: a free hex plus its free neighbours.
fn spawn(a: &mut Arena, i: usize, slot: u64) {
    let key = a.players[i].authority.to_bytes();
    let mut seed = slot ^ u64::from_le_bytes(key[0..8].try_into().unwrap());
    seed = mix(seed ^ (i as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15));
    let start = (seed % N as u64) as usize;
    // 97 is coprime with 540, so this walk visits every hex once.
    let at = |k: usize| (start + k * 97) % N;

    let mut chosen = NONE;
    for k in 0..MAX_PLAYERS {
        let (c, r) = SITES[(i + k) % MAX_PLAYERS];
        let t = r * W + c;
        if a.tiles[t] == 0 && clear_ring2(&a.tiles, t) {
            chosen = t;
            break;
        }
    }
    for k in 0..160 {
        if chosen != NONE {
            break;
        }
        let t = at(k);
        if a.tiles[t] == 0 && clear_ring2(&a.tiles, t) {
            chosen = t;
            break;
        }
    }
    if chosen == NONE {
        for k in 0..N {
            let t = at(k);
            if a.tiles[t] == 0 && clear_ring1(&a.tiles, t) {
                chosen = t;
                break;
            }
        }
    }
    if chosen == NONE {
        for k in 0..N {
            let t = at(k);
            if a.tiles[t] == 0 {
                chosen = t;
                break;
            }
        }
    }
    if chosen == NONE {
        a.players[i].tiles = 0;
        return;
    }

    let mine = tag(i);
    a.tiles[chosen] = mine;
    let mut count = 1u16;
    for n in neighbors(chosen) {
        if n != NONE && a.tiles[n] == 0 {
            a.tiles[n] = mine;
            count += 1;
        }
    }
    a.players[i].tiles = count;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_is_stable() {
        assert_eq!(core::mem::size_of::<Player>(), 64);
        assert_eq!(core::mem::size_of::<Champion>(), 56);
        assert_eq!(core::mem::size_of::<Arena>(), 1592);
    }

    #[test]
    fn neighbours_are_symmetric() {
        for i in 0..N {
            for n in neighbors(i) {
                if n != NONE {
                    assert!(neighbors(n).contains(&i), "{i} -> {n} not symmetric");
                }
            }
        }
    }
}
