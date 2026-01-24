const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

// name + digits + extension
const SEQ_REGEX = /^(.*?)(\d+)\.(png|jpg|jpeg)$/i;

class ImageConverter {
  async processAllImages(pluginDir, options = {}) {
    const imagesRoot = path.join(pluginDir, 'images');

    let converted = 0;
    let skipped = 0;

    const walkDir = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Collect files in this directory
      const files = entries
        .filter(e => e.isFile())
        .map(e => e.name);

      /** @type {Map<string, string[]>} */
      const sequences = new Map();

      for (const file of files) {
        if (!SEQ_REGEX.test(file)) continue;

        const [, base] = file.match(SEQ_REGEX);
        const key = base.trim();

        if (!sequences.has(key)) {
          sequences.set(key, []);
        }
        sequences.get(key).push(file);
      }

      // Convert each sequence
      for (const [baseName, seqFiles] of sequences.entries()) {
        if (seqFiles.length < 2) {
          skipped++;
          continue;
        }

        // Sort numerically
        seqFiles.sort((a, b) => {
          const na = parseInt(a.match(SEQ_REGEX)[2], 10);
          const nb = parseInt(b.match(SEQ_REGEX)[2], 10);
          return na - nb;
        });

        const listFile = path.join(dir, `._${baseName}_frames.txt`);
        const listContent = seqFiles
          .map(f => `file '${path.join(dir, f).replace(/\\/g, '/')}'`)
          .join('\n');

        await fs.writeFile(listFile, listContent);

        const outputPath = path.join(dir, `${baseName}.avif`);

        try {
          await execFileAsync('ffmpeg', [
            '-y',
            '-r', String(options.fps ?? 10),
            '-f', 'concat',
            '-safe', '0',
            '-i', listFile,
            '-c:v', 'libaom-av1',
            '-crf', String(options.crf ?? 40),
            '-cpu-used', String(options.speed ?? 6),
            '-pix_fmt', 'yuv420p',
            outputPath
          ]);

          console.log(`✔ ${path.relative(imagesRoot, outputPath)}`);
          converted++;
        } catch (err) {
          console.error(`✖ Failed: ${outputPath}`, err.message);
        } finally {
          await fs.unlink(listFile);
        }
      }

      // Recurse
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await walkDir(path.join(dir, entry.name));
        }
      }
    };

    await walkDir(imagesRoot);

    console.log(
      `\nConversion complete: ${converted} animated AVIFs, ${skipped} skipped`
    );
  }
}

module.exports = ImageConverter;
