/**
 * GeoTIFF processing utility for SolarScanner data layers
 * Based on Google's implementation pattern
 */

const geotiff = require("geotiff");
const proj4 = require("proj4");
const geokeysToProj4 = require("geotiff-geokeys-to-proj4");

class GeoTiffProcessor {
  /**
   * Process a GeoTIFF buffer
   * @param {Buffer} buffer - The GeoTIFF buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async process(buffer, options = {}) {
    try {
      // Log processing start with options
      console.log(
        `[GeoTiffProcessor] Processing GeoTIFF with options:`,
        options
      );

      // Validate buffer type and content
      this.validateBuffer(buffer);

      // Convert buffer to ArrayBuffer for geotiff.js
      const arrayBuffer = this.convertToArrayBuffer(buffer);

      // Parse the GeoTIFF
      const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
      const imageCount = await tiff.getImageCount();
      console.log(
        `[GeoTiffProcessor] GeoTIFF contains ${imageCount} images/pages`
      );

      // Get the image (default to first page if not specified)
      const pageIndex = options.page || 0;
      const image = await tiff.getImage(pageIndex);

      // Extract metadata
      const width = image.getWidth();
      const height = image.getHeight();
      const fileDirectory = image.getFileDirectory();
      const tiepoint = image.getTiePoints()[0];
      const pixelScale = fileDirectory.ModelPixelScale;

      // Get geospatial info if available
      let geoKeys = null;
      try {
        geoKeys = image.getGeoKeys();
      } catch (error) {
        console.warn(
          `[GeoTiffProcessor] GeoKeys not available: ${error.message}`
        );
      }

      // Log image characteristics
      console.log(`[GeoTiffProcessor] Image dimensions: ${width}x${height}`);
      console.log(
        `[GeoTiffProcessor] Samples per pixel: ${image.getSamplesPerPixel()}`
      );
      console.log(
        `[GeoTiffProcessor] Bits per sample: ${fileDirectory.BitsPerSample[0]}`
      );

      // Configure raster reading options
      const readOptions = {};
      if (options.samples) {
        readOptions.samples = options.samples;
      }
      if (options.window) {
        readOptions.window = options.window;
      }
      if (options.interleave !== undefined) {
        readOptions.interleave = options.interleave;
      }

      // Read the raster data
      console.log(
        `[GeoTiffProcessor] Reading rasters with options:`,
        readOptions
      );
      const rasters = await image.readRasters(readOptions);

      // Process rasters based on options
      const processedRasters = [];
      for (let i = 0; i < rasters.length; i++) {
        // Convert to regular array if requested
        const raster = options.convertToArray
          ? Array.from(rasters[i])
          : rasters[i];

        // Sample and log raster values for verification
        this.logRasterSamples(raster, i, width, height);

        processedRasters.push(raster);
      }

      // Get geographic bounds
      let bbox = null;
      try {
        bbox = image.getBoundingBox();
      } catch (error) {
        console.warn(
          `[GeoTiffProcessor] Could not get bounding box: ${error.message}`
        );
        bbox = [0, 0, width, height];
      }

      // Reproject bounds to WGS84 lat/lon
      const bounds = this.reprojectBounds(bbox, geoKeys);

      // Return processed data structure
      return {
        metadata: {
          width,
          height,
          tiepoint,
          pixelScale,
          geoKeys,
          bands: rasters.length,
          fileDirectory,
          pages: imageCount,
        },
        rasters: processedRasters,
        bounds,
        originalBbox: bbox,
      };
    } catch (error) {
      console.error(
        `[GeoTiffProcessor] Error processing GeoTIFF: ${error.message}`
      );
      throw new Error(`Failed to process GeoTIFF: ${error.message}`);
    }
  }

  /**
   * Validate buffer type and content
   * @private
   * @param {Buffer} buffer - Buffer to validate
   * @throws {Error} if buffer is invalid
   */
  validateBuffer(buffer) {
    if (!buffer) {
      throw new Error("Buffer is null or undefined");
    }

    if (buffer.byteLength === 0) {
      throw new Error("Buffer is empty (zero length)");
    }

    // Log buffer info for debugging
    console.log(`[GeoTiffProcessor] Buffer info:
      Type: ${typeof buffer}
      Is Buffer: ${buffer instanceof Buffer}
      Is ArrayBuffer: ${buffer instanceof ArrayBuffer}
      Is Uint8Array: ${buffer instanceof Uint8Array}
      Length: ${buffer.byteLength || buffer.length || "unknown"}
    `);
  }

  /**
   * Convert buffer to ArrayBuffer for geotiff.js
   * @private
   * @param {Buffer|ArrayBuffer|Uint8Array} buffer - Buffer to convert
   * @returns {ArrayBuffer} - ArrayBuffer for geotiff.js
   */
  convertToArrayBuffer(buffer) {
    if (buffer instanceof ArrayBuffer) {
      return buffer;
    } else if (buffer instanceof Buffer || buffer instanceof Uint8Array) {
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      );
    } else {
      throw new Error(`Cannot convert ${typeof buffer} to ArrayBuffer`);
    }
  }

  /**
   * Log sample values from raster for debugging
   * @private
   * @param {TypedArray|Array} raster - Raster data
   * @param {number} index - Raster index
   * @param {number} width - Image width
   * @param {number} height - Image height
   */
  logRasterSamples(raster, index, width, height) {
    if (!raster || raster.length === 0) return;

    // Sample different regions of the raster
    const centerY = Math.floor(height / 2);
    const centerX = Math.floor(width / 2);

    // Get top-left, center, and random samples
    const samples = {
      topLeft: raster[0],
      topRight: raster[width - 1],
      center: raster[centerY * width + centerX],
      bottomLeft: raster[(height - 1) * width],
      bottomRight: raster[(height - 1) * width + (width - 1)],
    };

    // Sample row averages
    const rowSamples = [];
    for (
      let row = 0;
      row < height;
      row += Math.max(1, Math.floor(height / 10))
    ) {
      let sum = 0;
      let count = 0;

      for (let x = 0; x < width; x++) {
        const value = raster[row * width + x];
        if (value !== undefined && !isNaN(value)) {
          sum += value;
          count++;
        }
      }

      rowSamples.push({
        row,
        avg: count > 0 ? sum / count : NaN,
      });
    }

    // Log samples
    console.log(`[GeoTiffProcessor] Raster ${index} samples:`, samples);
    console.log(`[GeoTiffProcessor] Row average samples:`);
    rowSamples.forEach((sample) => {
      if (!isNaN(sample.avg)) {
        console.log(`  Row ${sample.row}: ${sample.avg.toFixed(2)}`);
      }
    });
  }

  /**
   * Reproject bounding box to standard lat/lon coordinates
   * @private
   * @param {Array<number>} bbox - Bounding box [west, south, east, north]
   * @param {Object} geoKeys - GeoTIFF geoKeys
   * @returns {Object} - Bounds object {north, south, east, west}
   */
  reprojectBounds(bbox, geoKeys) {
    try {
      // Handle missing geoKeys
      if (!geoKeys) {
        console.warn(
          "[GeoTiffProcessor] No GeoKeys for reprojection, using original bbox"
        );
        return {
          north: bbox[3],
          south: bbox[1],
          east: bbox[2],
          west: bbox[0],
        };
      }

      // Convert geoKeys to proj4 format
      const projObj = geokeysToProj4.toProj4(geoKeys);

      // Create projection function
      const projection = proj4(projObj.proj4, "WGS84");

      // Get coordinate conversion parameters
      const convParams = projObj.coordinatesConversionParameters || {
        x: 1,
        y: 1,
      };

      // Convert southwest and northeast corners
      const sw = projection.forward({
        x: bbox[0] * convParams.x,
        y: bbox[1] * convParams.y,
      });

      const ne = projection.forward({
        x: bbox[2] * convParams.x,
        y: bbox[3] * convParams.y,
      });

      // Return standardized bounds
      return {
        north: ne.y,
        south: sw.y,
        east: ne.x,
        west: sw.x,
      };
    } catch (error) {
      console.error(
        `[GeoTiffProcessor] Error reprojecting bounds: ${error.message}`
      );

      // Return original bounds on error
      return {
        north: bbox[3],
        south: bbox[1],
        east: bbox[2],
        west: bbox[0],
      };
    }
  }

  /**
   * Find valid data range in a raster
   * @param {TypedArray|Array} raster - Raster data
   * @param {number} [noDataValue=-9999] - Value to ignore
   * @returns {Object} - Data range {min, max}
   */
  findDataRange(raster, noDataValue = -9999) {
    try {
      let min = Infinity;
      let max = -Infinity;
      let validCount = 0;

      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value) && isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
          validCount++;
        }
      }

      // Check for valid range
      if (validCount === 0 || min === Infinity || max === -Infinity) {
        console.warn("[GeoTiffProcessor] No valid data found in raster");
        return { min: 0, max: 1, validCount: 0 };
      }

      return { min, max, validCount };
    } catch (error) {
      console.error(
        `[GeoTiffProcessor] Error finding data range: ${error.message}`
      );
      return { min: 0, max: 1, validCount: 0 };
    }
  }
}

module.exports = GeoTiffProcessor;
