export interface FfProbeOutput {
  format: FfprobeFormat;
  streams: (FfprobeAudioStream | FfprobeSubtitleStream)[];
}

export interface FfprobeFormat {
  duration: number;
}

export interface FfprobeStream {
  codec_type: "audio" | "subtitle";
  index: number;
  codec_name: string;
  disposition: FfprobeDispositionMap;
  tags: { [key: string]: string } | undefined;
}

export interface FfprobeAudioStream extends FfprobeStream {
  codec_type: "audio";
  channel_layout: string;
}

export interface FfprobeSubtitleStream extends FfprobeStream {
  codec_type: "subtitle";
}

export interface FfprobeDispositionMap {
  [key: string]: 0 | 1;
}

export function convertFfprobeDispositionMapToDispositionListWithoutDefault(
  ffprobeDispositionMap: FfprobeDispositionMap
): readonly string[] {
  return Object.keys(ffprobeDispositionMap).filter(
    (disposition) =>
      disposition !== "default" && ffprobeDispositionMap[disposition] === 1
  );
}
