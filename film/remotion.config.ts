import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");

// Remotion's own headless shell never paints a frame on this machine; the installed Chrome does.
Config.setBrowserExecutable(process.env.REMOTION_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
Config.setChromeMode("chrome-for-testing");
