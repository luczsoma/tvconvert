import { Config } from "./config";

export const EXAMPLE_CONFIG: Config = {
  ffmpegBinaryPath: "/usr/local/bin/ffmpeg",
  ffprobeBinaryPath: "/usr/local/bin/ffprobe",
  outputFolderPath: "./converted",
  movies: [
    {
      title: "The Matrix",
      year: 1999,
      inputFilePath: "./downloaded/The Matrix (1999)/The Matrix (1999).mkv",
    },
  ],
};
