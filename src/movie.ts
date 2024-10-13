import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { currentYear } from "./currentYear";
import {
  convertFfprobeDispositionMapToDispositionListWithoutDefault,
  FfProbeOutput,
} from "./ffprobe";
import { question } from "./utils";

interface Stream {
  readonly index: number;
  readonly codecName: string;
  readonly language: string | undefined;
  readonly title: string | undefined;
  readonly dispositionsWithoutDefault: readonly string[];
}

interface AudioStream extends Stream {
  readonly channelLayout: string;
}

interface SubtitleStream extends Stream {}

interface ContainerInfo {
  readonly containerDurationSeconds: number;
  readonly audioStreams: readonly AudioStream[];
  readonly subtitleStreams: readonly SubtitleStream[];
}

interface ConversionInfo {
  readonly containerDurationSeconds: number;
  readonly audioStreams: readonly AudioStream[];
  readonly selectedAudioStream: AudioStream;
  readonly subtitleStreams: readonly SubtitleStream[];
  readonly selectedSubtitleStream: SubtitleStream | null;
}

interface ConversionResult {
  successful: boolean;
  stderr: string;
}

export interface IMovie {
  readonly title: string;
  readonly year: number;
  readonly inputFilePath: string;
}

export class Movie implements IMovie {
  private conversionInfo: ConversionInfo | undefined;
  private conversionResult: ConversionResult | undefined;

  public static fromIMovie(movie: IMovie): Movie {
    return new Movie(movie.title, movie.year, movie.inputFilePath);
  }

  private constructor(
    public readonly title: string,
    public readonly year: number,
    public readonly inputFilePath: string
  ) {}

  public getFullyQualifiedName(fileNameSafe: boolean): string {
    let title = this.title;
    if (fileNameSafe) {
      title = title.replace(/[^a-zA-Z0-9-_ ]/g, "");
    }
    const fullyQualifiedName = `${title} (${this.year})`;
    return fullyQualifiedName;
  }

  public hasValidInputFilePath(): boolean {
    return (
      typeof this.inputFilePath === "string" && existsSync(this.inputFilePath)
    );
  }

  public hasValidTitle(): boolean {
    return typeof this.title === "string" && this.title.length > 0;
  }

  public hasValidYear(): boolean {
    return (
      typeof this.year === "number" &&
      // Roundhay Garden Scene from 1888 is believed to be the oldest surviving film
      this.year >= 1888 &&
      this.year <= currentYear
    );
  }

  public async collectConversionInfo(ffprobeBinaryPath: string): Promise<void> {
    console.log(`Collecting info for: ${this.getFullyQualifiedName(false)}…`);

    const { containerDurationSeconds, audioStreams, subtitleStreams } =
      this.getInputFileMediaInfo(this.inputFilePath, ffprobeBinaryPath);

    const selectedAudioStream = await this.selectAudioStream(audioStreams);
    const selectedSubtitleStream = await this.selectSubtitleStream(
      subtitleStreams
    );

    this.conversionInfo = {
      containerDurationSeconds,
      audioStreams,
      selectedAudioStream,
      subtitleStreams,
      selectedSubtitleStream,
    };
  }

  public async convert(
    outputFolderPath: string,
    ffmpegBinaryPath: string,
    currentFileIndex: number,
    allFilesCount: number
  ): Promise<void> {
    if (this.conversionInfo === undefined) {
      throw new Error(
        "AssertError: must call collectConversionInfo() before convert()"
      );
    }

    const globalArguments = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostats",
      "-progress",
      "pipe:1",
      "-y",
    ];

    const inputFileArguments = ["-i", this.inputFilePath];

    const outputsArguments = [
      this.getMkvOutputArguments(outputFolderPath, this.conversionInfo),
      this.getSrtOutputArguments(outputFolderPath, this.conversionInfo),
    ];

    const ffmpegArguments = [
      ...globalArguments,
      ...inputFileArguments,
      ...outputsArguments.flat(),
    ];

    mkdirSync(
      this.getOutputSubfolderPath(
        outputFolderPath,
        this.conversionInfo.selectedSubtitleStream
      ),
      {
        recursive: true,
      }
    );

    const { containerDurationSeconds } = this.conversionInfo;

    return new Promise((resolve) => {
      const ffmpeg = spawn(ffmpegBinaryPath, ffmpegArguments);
      ffmpeg.stdout.setEncoding("utf8");

      let roundedProgressPercentage = this.getRoundedProgressPercentage(0);
      ffmpeg.stdout.on("data", (data) => {
        const outTimeMicroseconds = data.match(/out_time_us=(.+)\n/)[1];
        const speed = data.match(/speed=(.+)\n/)[1];

        if (outTimeMicroseconds === "N/A" || speed === "N/A") {
          return;
        }

        const outTimeSeconds = outTimeMicroseconds / 1e6;
        const progress = outTimeSeconds / containerDurationSeconds;
        const newRoundedProgressPercentage =
          this.getRoundedProgressPercentage(progress);
        if (newRoundedProgressPercentage !== roundedProgressPercentage) {
          roundedProgressPercentage = newRoundedProgressPercentage;
          this.logProgress(
            currentFileIndex,
            allFilesCount,
            roundedProgressPercentage,
            speed
          );
        }
      });

      let stderr = "";
      ffmpeg.stderr.setEncoding("utf8");
      ffmpeg.stderr.on("data", (data) => {
        stderr += data;
      });

      ffmpeg.on("close", (exitCode) => {
        this.conversionResult = {
          successful: exitCode === 0,
          stderr,
        };
        resolve();
      });
    });
  }

  public getConversionResult(): ConversionResult {
    if (this.conversionResult === undefined) {
      throw new Error("AssertError: conversion did not finish yet");
    }
    return this.conversionResult;
  }

  private getOutputSubfolderPath(
    outputFolderPath: string,
    selectedSubtitleStream: SubtitleStream | null
  ): string {
    const outputSubfolderName =
      selectedSubtitleStream === null ? "external_subtitle_needed" : "ready";
    return join(
      outputFolderPath,
      outputSubfolderName,
      this.getFullyQualifiedName(true)
    );
  }

  private getInputFileMediaInfo(
    inputFilePath: string,
    ffprobeBinary: string
  ): ContainerInfo {
    const { stdout } = spawnSync(
      ffprobeBinary,
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-show_format",
        "-show_streams",
        "-output_format",
        "json",
        inputFilePath,
      ],
      {
        encoding: "utf8",
      }
    );

    const ffprobeOutput: FfProbeOutput = JSON.parse(stdout);

    const audioStreams: AudioStream[] = ffprobeOutput.streams
      .filter((s) => s.codec_type === "audio")
      .map((s) => ({
        index: s.index,
        codecName: s.codec_name,
        language: s.tags?.["language"],
        title: s.tags?.["title"],
        dispositionsWithoutDefault:
          convertFfprobeDispositionMapToDispositionListWithoutDefault(
            s.disposition
          ),
        channelLayout: s.channel_layout,
      }));

    const subtitleStreams: SubtitleStream[] = ffprobeOutput.streams
      .filter((s) => s.codec_type === "subtitle")
      .map((s) => ({
        index: s.index,
        codecName: s.codec_name,
        language: s.tags?.["language"],
        title: s.tags?.["title"],
        dispositionsWithoutDefault:
          convertFfprobeDispositionMapToDispositionListWithoutDefault(
            s.disposition
          ),
      }));

    return {
      containerDurationSeconds: ffprobeOutput.format.duration,
      audioStreams,
      subtitleStreams,
    };
  }

  private async selectAudioStream(
    audioStreams: readonly AudioStream[]
  ): Promise<AudioStream> {
    console.table(
      audioStreams.map((stream) => ({
        Index: stream.index,
        Language: stream.language,
        Codec: stream.codecName,
        "Channel layout": stream.channelLayout,
        Title: stream.title ?? "",
      }))
    );

    while (true) {
      const audioStreamSelectionAnswer = await question(
        "Select audio stream index: "
      );
      const audioStreamIndexCandidate = Number.parseInt(
        audioStreamSelectionAnswer,
        10
      );
      const selectedAudioStream = audioStreams.find(
        (audioStream) => audioStream.index === audioStreamIndexCandidate
      );
      if (selectedAudioStream !== undefined) {
        return selectedAudioStream;
      }
    }
  }

  private async selectSubtitleStream(
    subtitleStreams: readonly SubtitleStream[]
  ): Promise<SubtitleStream | null> {
    console.table(
      subtitleStreams
        .filter((s) => s.codecName === "subrip")
        .map((stream) => ({
          Index: stream.index,
          Language: stream.language,
          Title: stream.title ?? "",
        }))
    );

    while (true) {
      const subtitleStreamSelectionAnswer = await question(
        "Select subtitle stream index (leave empty if using external subtitles): "
      );
      if (subtitleStreamSelectionAnswer === "") {
        return null;
      }
      const subtitleStreamIndexCandidate = Number.parseInt(
        subtitleStreamSelectionAnswer,
        10
      );
      const selectedSubtitleStream = subtitleStreams.find(
        (subtitleStream) =>
          subtitleStream.index === subtitleStreamIndexCandidate
      );
      if (selectedSubtitleStream !== undefined) {
        return selectedSubtitleStream;
      }
    }
  }

  private getMkvOutputArguments(
    outputFolderPath: string,
    conversionInfo: ConversionInfo
  ): readonly string[] {
    const mkvOutputArguments = [
      // do not transcode any streams unless explicitly specified
      "-codec",
      "copy",

      // remove all metadata
      "-map_metadata",
      "-1",

      // remove all chapters
      "-map_chapters",
      "-1",

      // map video streams (that are not attached pictures, video thumbnails, or cover arts)
      "-map",
      "0:V",

      // map the selected audio input stream to the first audio output stream
      "-map",
      `0:${conversionInfo.selectedAudioStream.index}`,
    ];

    // map all audio input streams
    for (const audioStream of conversionInfo.audioStreams) {
      mkvOutputArguments.push("-map", `0:${audioStream.index}`);
    }

    // map all subtitle input streams
    for (const subtitleStream of conversionInfo.subtitleStreams) {
      mkvOutputArguments.push("-map", `0:${subtitleStream.index}`);
    }

    // for the first audio output stream (mapped from the selected audio input stream)
    mkvOutputArguments.push(
      // transcode to AAC at 128k bitrate
      "-codec:a:0",
      "aac",
      "-b:a:0",
      "128k",

      // downmix to 2.0
      "-ac:a:0",
      "2",

      ...this.getStreamMetadataArguments(
        "a:0",
        conversionInfo.selectedAudioStream.language,
        "aac",
        undefined,
        "stereo"
      ),

      ...this.getStreamDispositionArguments(
        "a:0",
        conversionInfo.selectedAudioStream.dispositionsWithoutDefault,
        true
      )
    );

    // for all other audio output streams
    conversionInfo.audioStreams.forEach((audioStream, i) => {
      mkvOutputArguments.push(
        ...this.getStreamMetadataArguments(
          `a:${i + 1}`,
          audioStream.language,
          audioStream.codecName,
          audioStream.title,
          audioStream.channelLayout
        ),

        ...this.getStreamDispositionArguments(
          `a:${i + 1}`,
          audioStream.dispositionsWithoutDefault,
          false
        )
      );
    });

    // for all subtitle output streams
    conversionInfo.subtitleStreams.forEach((subtitleStream, i) => {
      mkvOutputArguments.push(
        ...this.getStreamMetadataArguments(
          `s:${i}`,
          subtitleStream.language,
          subtitleStream.codecName,
          subtitleStream.title
        ),

        ...this.getStreamDispositionArguments(
          `s:${i}`,
          subtitleStream.dispositionsWithoutDefault,
          false
        )
      );
    });

    mkvOutputArguments.push(
      this.getMkvOutputFilePath(
        outputFolderPath,
        conversionInfo.selectedSubtitleStream
      )
    );

    return mkvOutputArguments;
  }

  private getSrtOutputArguments(
    outputFolderPath: string,
    conversionInfo: ConversionInfo
  ): readonly string[] {
    // do not produce an srt output if there is no selected subtitle stream
    if (conversionInfo.selectedSubtitleStream === null) {
      return [];
    }

    return [
      "-map",
      `0:${conversionInfo.selectedSubtitleStream.index}`,
      this.getSrtOutputFilePath(
        outputFolderPath,
        conversionInfo.selectedSubtitleStream
      ),
    ];
  }

  private logProgress(
    currentFileIndex: number,
    allFilesCount: number,
    progressPercentageRounded: string,
    speed: number
  ) {
    console.log(
      `[${currentFileIndex} / ${allFilesCount}] ${this.getFullyQualifiedName(
        false
      )} [${progressPercentageRounded}% at ${speed}]`
    );
  }

  private getMkvOutputFilePath(
    outputFolderPath: string,
    selectedSubtitleStream: SubtitleStream | null
  ): string {
    const outputSubfolderPath = this.getOutputSubfolderPath(
      outputFolderPath,
      selectedSubtitleStream
    );
    const outputFileName = `${this.getFullyQualifiedName(true)}.mkv`;
    return join(outputSubfolderPath, outputFileName);
  }

  private getSrtOutputFilePath(
    outputFolderPath: string,
    selectedSubtitleStream: SubtitleStream
  ): string {
    const outputSubfolderPath = this.getOutputSubfolderPath(
      outputFolderPath,
      selectedSubtitleStream
    );
    const outputFileName = [
      this.getFullyQualifiedName(true),
      selectedSubtitleStream.language ?? "???",
      "srt",
    ].join(".");
    return join(outputSubfolderPath, outputFileName);
  }

  private getStreamMetadataArguments(
    streamSpecifier: string,
    language: string | undefined,
    codecName: string,
    originalTitle: string | undefined,
    channelLayout?: string | undefined
  ): readonly string[] {
    let ret = [
      // set title
      `-metadata:s:${streamSpecifier}`,
      `title=${this.getStreamTitle(
        language,
        codecName,
        originalTitle,
        channelLayout
      )}`,
    ];

    // set language if exists
    if (language !== undefined) {
      ret.push(`-metadata:s:${streamSpecifier}`, `language=${language}`);
    }

    return ret;
  }

  private getStreamTitle(
    language: string | undefined,
    codecName: string,
    originalTitle: string | undefined,
    channelLayout?: string | undefined
  ): string {
    let lang = language ?? "???";
    let ret = `${lang} ${codecName}`;
    if (channelLayout !== undefined) {
      ret += ` ${channelLayout}`;
    }
    if (originalTitle !== undefined) {
      ret += ` [${originalTitle}]`;
    }
    return ret;
  }

  private getStreamDispositionArguments(
    streamSpecifier: string,
    dispositionsWithoutDefault: readonly string[],
    isDefault: boolean
  ): readonly string[] {
    const disposition = this.getDisposition(
      dispositionsWithoutDefault,
      isDefault
    );
    if (disposition === "") {
      return [];
    }
    return [`-disposition:${streamSpecifier}`, disposition];
  }

  private getDisposition(
    dispositionsWithoutDefault: readonly string[],
    isDefault: boolean
  ): string {
    let ret = [...dispositionsWithoutDefault];

    if (isDefault) {
      ret.unshift("default");
    }

    return ret.join("+");
  }

  private getRoundedProgressPercentage(normalizedProgress: number) {
    return (normalizedProgress * 100).toFixed(2);
  }
}
