# tvconvert

Converts movies into a format suitable for my home setup. For each configured movie, it produces:

- an MKV with all original video, audio, and subtitle streams copied over (metadata and chapters stripped, stream titles normalized), plus an interactively selected audio stream transcoded into a loudness-normalized (`loudnorm=lra=10`) stereo AAC track (48 kHz, 256 kbps) as the new default audio track,
- an SRT file extracted from an interactively selected SubRip subtitle stream, if the movie contains any.

Each movie is written into its own `Title (Year)/` folder inside the output folder, and lands under `ready/` or `external_subtitle_needed/` depending on where its subtitle comes from: `ready/` movies had their subtitle extracted from the movie file itself and are complete as-is, while `external_subtitle_needed/` movies carried no suitable embedded SubRip subtitle stream, so a matching SRT still has to be sourced separately:

```
<outputFolderPath>/
├── ready/
│   └── The Matrix (1999)/
│       ├── The Matrix (1999).mkv
│       └── The Matrix (1999).eng.srt
└── external_subtitle_needed/
    ├── The Matrix Reloaded (2003)/
    │   └── The Matrix Reloaded (2003).mkv
    └── The Matrix Revolutions (2003)/
        └── The Matrix Revolutions (2003).mkv
```

## Requirements

- Node.js 22+, npm 10+
- ffmpeg 7+ and ffprobe

## Install

```sh
git clone git@github.com:luczsoma/tvconvert.git
cd tvconvert
npm install
npm run build
```

Optionally, put the `tvconvert` command on your `PATH`:

```sh
npm link
```

Without `npm link`, substitute `node build/tvconvert.js` for `tvconvert` below.

## Usage

1. Generate a config skeleton:

   ```sh
   tvconvert -p config.json
   ```

2. Edit `config.json`:

   | Field               | Meaning                                                        |
   | ------------------- | -------------------------------------------------------------- |
   | `ffmpegBinaryPath`  | Absolute path to an ffmpeg 7+ binary                           |
   | `ffprobeBinaryPath` | Absolute path to an ffprobe binary                             |
   | `outputFolderPath`  | Existing folder where the converted movies are written         |
   | `movies`            | List of `{ title, year, inputFilePath }` entries to convert    |
   | `dryRun`            | If `true`, print the ffmpeg commands instead of executing them |

3. Run the conversion:

   ```sh
   tvconvert -c config.json
   ```

   For every movie, the tool lists the available audio and subtitle streams and asks which audio stream to transcode and which subtitle stream to extract (leave the subtitle answer empty when using external subtitles). Conversions then run one after another, reporting progress like:

   ```
   [1 / 3] The Matrix (1999) [30.30% at 1.01x]
   ```

   A failed conversion does not stop the batch. After the whole batch has finished, each failed movie’s ffmpeg error output is printed, and the process exits with a non-zero code.
