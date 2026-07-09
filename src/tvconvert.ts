#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { Config } from "./config.js";
import { Movie } from "./movie.js";

function printHelp(): void {
  console.log("Usage:");
  console.log("  tvconvert -c|--config <configfile>.json");
  console.log("    Convert the movies listed in the given config file.");
  console.log("  tvconvert -p|--print-config <configfile>.json");
  console.log("    Write an example config skeleton into the given file.");
}

async function main() {
  const [mode, configFilePath, ...surplusArgs] = argv.slice(2);

  if (
    mode === undefined ||
    configFilePath === undefined ||
    !["-c", "--config", "-p", "--print-config"].some((m) => m === mode) ||
    surplusArgs.length > 0
  ) {
    printHelp();
    return 1;
  }

  if (["-p", "--print-config"].some((m) => m === mode)) {
    writeFileSync(
      configFilePath,
      `${JSON.stringify(Config.getExampleConfig(), null, 2)}\n`,
    );
    return 0;
  }

  let config: Config;
  try {
    config = Config.parseFromFile(configFilePath);
  } catch (ex) {
    console.error(ex instanceof Error ? ex.message : ex);
    return 1;
  }

  const movies = config.movies.map((movie) => Movie.fromIMovie(movie));

  for (const movie of movies) {
    await movie.collectConversionInfo(config.ffprobeBinaryPath);
  }

  let currentFileIndex = 0;
  for (const movie of movies) {
    await movie.convert(
      config.outputFolderPath,
      config.ffmpegBinaryPath,
      config.dryRun,
      ++currentFileIndex,
      movies.length,
    );
  }

  if (config.dryRun) {
    return 0;
  }

  const moviesWithConversionError = movies.filter(
    (movie) => !movie.getConversionResult().successful,
  );
  if (moviesWithConversionError.length > 0) {
    for (const movie of moviesWithConversionError) {
      console.log(
        `\n${movie.getFullyQualifiedName(false)}\n${
          movie.getConversionResult().stderr
        }`,
      );
    }
    console.log(`\nFINISHED WITH ${moviesWithConversionError.length} ERRORS`);
    return 1;
  }

  console.log("\nSUCCESS");
  return 0;
}

const exitCode = await main();
exit(exitCode);
