import { writeFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { Config } from "./config";
import { EXAMPLE_CONFIG } from "./exampleConfig";
import { Movie } from "./movie";

function printHelp(): void {
  console.log("Read config from {configfile}.json:");
  console.log("  tvconvert.sh -c {configfile}.json");
  console.log("  tvconvert.sh --config {configfile}.json");
  console.log("Print config skeleton into {configfile}.json:");
  console.log("  tvconvert.sh -p {configfile}.json");
  console.log("  tvconvert.sh --print-config {configfile}.json");
}

async function main() {
  const args = argv.slice(2);
  if (args.length !== 2) {
    printHelp();
    return 1;
  }

  const mode = args[0]!;
  const configFilePath = args[1]!;

  if (!["-c", "--config", "-p", "--print-config"].some((m) => m === mode)) {
    printHelp();
    return 1;
  }

  if (["-p", "--print-config"].some((m) => m === mode)) {
    writeFileSync(
      configFilePath,
      `${JSON.stringify(EXAMPLE_CONFIG, null, 2)}\n`
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
      ++currentFileIndex,
      movies.length
    );
  }

  const moviesWithConversionError = movies.filter(
    (movie) => !movie.getConversionResult().successful
  );
  if (moviesWithConversionError.length > 0) {
    for (const movie of moviesWithConversionError) {
      console.log(
        `\n${movie.getFullyQualifiedName(false)}\n${
          movie.getConversionResult().stderr
        }`
      );
    }
    console.log(`\nFINISHED WITH ${moviesWithConversionError.length} ERRORS`);
    return 1;
  }

  console.log("\nSUCCESS");
  return 0;
}

main().then((exitCode) => {
  exit(exitCode);
});
