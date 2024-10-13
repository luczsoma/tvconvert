import { existsSync, readFileSync } from "node:fs";
import { IMovie, Movie } from "./movie";

export class Config {
  private constructor(
    public readonly ffmpegBinaryPath: string,
    public readonly ffprobeBinaryPath: string,
    public readonly outputFolderPath: string,
    public readonly movies: readonly IMovie[]
  ) {}

  public static parseFromFile(configFilePath: string): Config {
    const configFileContents = readFileSync(configFilePath, {
      encoding: "utf-8",
    });
    return Config.parse(configFileContents);
  }

  private static parse(configString: string): Config {
    const config: Config = JSON.parse(configString);

    if (
      typeof config.ffmpegBinaryPath !== "string" ||
      !existsSync(config.ffmpegBinaryPath)
    ) {
      throw new Error("config.ffmpegBinaryPath does not exist");
    }

    if (
      typeof config.ffprobeBinaryPath !== "string" ||
      !existsSync(config.ffprobeBinaryPath)
    ) {
      throw new Error("config.ffprobeBinaryPath does not exist");
    }

    if (
      typeof config.outputFolderPath !== "string" ||
      !existsSync(config.outputFolderPath)
    ) {
      throw new Error("config.outputFolderPath does not exist");
    }

    if (!Array.isArray(config.movies)) {
      throw new Error("config.movies is not an array");
    }

    const movies = (config.movies as readonly IMovie[]).map((movie) =>
      Movie.fromIMovie(movie)
    );

    const moviesWithInvalidInputFilePaths = movies.filter(
      (movie) => !movie.hasValidInputFilePath()
    );
    if (moviesWithInvalidInputFilePaths.length > 0) {
      throw new Error(
        `The following input files do not exist:\n${moviesWithInvalidInputFilePaths
          .map((movie) => movie.inputFilePath)
          .join("\n")}`
      );
    }

    const moviesWithInvalidTitles = movies.filter(
      (movie) => !movie.hasValidTitle()
    );
    if (moviesWithInvalidTitles.length > 0) {
      throw new Error(
        `The following movie titles are invalid:\n${moviesWithInvalidTitles
          .map((movie) => movie.title)
          .join("\n")}`
      );
    }

    const moviesWithInvalidYears = movies.filter(
      (movie) => !movie.hasValidYear()
    );
    if (moviesWithInvalidYears.length > 0) {
      throw new Error(
        `The following movies' years are invalid:\n${moviesWithInvalidYears
          .map((movie) => movie.title)
          .join("\n")}`
      );
    }

    return config;
  }
}
