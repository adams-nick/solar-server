/**
 * GeoTIFF processing utility for SolarScanner data layers
 */

const geotiff = require("geotiff");
const proj4 = require("proj4");
const geokeysToProj4 = require("geotiff-geokeys-to-proj4");
const sharp = require("sharp"); // For additional image processing capabilities

class GeoTiffProcessor {
  /**
   * Process a GeoTIFF buffer
   * @param {Buffer} buffer - The GeoTIFF buffer
   * @param {Object} options - Processing options
   * @param {number} [options.page=0] - Page/image index for multi-page TIFFs
   * @param {Array<number>} [options.samples] - Specific samples/bands to read
   * @param {boolean} [options.useSharp=false] - Use sharp for processing if true
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async process(buffer, options = {}) {
    try {
      // Choose between geotiff.js and sharp processing
      if (options.useSharp) {
        return this.processWithSharp(buffer, options);
      } else {
        return this.processWithGeotiff(buffer, options);
      }
    } catch (error) {
      console.error(`Error processing GeoTIFF: ${error.message}`);
      throw new Error(`Failed to process GeoTIFF: ${error.message}`);
    }
  }

  /**
   * Process GeoTIFF buffer using geotiff.js library
   * @private
   * @param {Buffer} buffer - The GeoTIFF buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async processWithGeotiff(buffer, options = {}) {
    try {
      console.log("Processing GeoTIFF with geotiff.js library");

      // Parse the GeoTIFF
      const tiff = await geotiff.fromArrayBuffer(buffer);

      // Get the image (for multi-page TIFFs, can specify page)
      const image = await tiff.getImage(options.page || 0);

      // Get image dimensions
      const width = image.getWidth();
      const height = image.getHeight();

      // Get metadata
      const fileDirectory = image.getFileDirectory();
      const tiepoint = image.getTiePoints()[0];
      const pixelScale = fileDirectory.ModelPixelScale;
      const geoKeys = image.getGeoKeys();

      // Read rasters (bands)
      const readOptions = {};
      if (options.samples) {
        readOptions.samples = options.samples;
      }

      const rasters = await image.readRasters(readOptions);

      // Convert rasters from TypedArrays to regular arrays if needed
      const processedRasters = [];
      for (let i = 0; i < rasters.length; i++) {
        if (options.convertToArray) {
          processedRasters.push(Array.from(rasters[i]));
        } else {
          processedRasters.push(rasters[i]);
        }
      }

      // Get bounding box in original projection
      const bbox = image.getBoundingBox();

      // Reproject bounds to standard lat/lon
      const bounds = this.reprojectBounds(bbox, geoKeys);

      // Count total bands in the image
      const totalBands = image.getSamplesPerPixel();

      return {
        metadata: {
          width,
          height,
          tiepoint,
          pixelScale,
          geoKeys,
          bands: totalBands,
          fileDirectory,
          pages: tiff.getImageCount(),
        },
        rasters: processedRasters,
        bounds,
        originalBbox: bbox,
      };
    } catch (error) {
      console.error(`Error in processWithGeotiff: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process GeoTIFF buffer using sharp library
   * @private
   * @param {Buffer} buffer - The GeoTIFF buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed GeoTIFF data
   */
  async processWithSharp(buffer, options = {}) {
    try {
      console.log("Processing GeoTIFF with sharp library");

      // Create sharp instance
      const sharpImg = sharp(buffer);

      // Get image metadata
      const metadata = await sharpImg.metadata();

      // Extract specific page if this is a multi-page TIFF
      if (metadata.pages > 1 && options.page !== undefined) {
        sharpImg.page(options.page);
      }

      // Extract the raw pixel data
      const { data, info } = await sharpImg
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Create a simple raster from the raw data
      // Note: Sharp doesn't provide direct access to geographic metadata
      // So we'll need to use geotiff.js to get that info

      // Use geotiff.js just to get the geographic metadata
      const tiff = await geotiff.fromArrayBuffer(buffer);
      const image = await tiff.getImage(options.page || 0);
      const geoKeys = image.getGeoKeys();
      const bbox = image.getBoundingBox();
      const bounds = this.reprojectBounds(bbox, geoKeys);

      // Split the data into separate bands/channels
      const rasters = [];
      const channels = info.channels;

      // If this is grayscale, we have one channel
      if (channels === 1) {
        rasters.push(data);
      } else {
        // For multi-channel images, split into separate bands
        for (let c = 0; c < channels; c++) {
          const bandData = new Uint8Array(info.width * info.height);
          for (let i = 0; i < info.width * info.height; i++) {
            bandData[i] = data[i * channels + c];
          }
          rasters.push(bandData);
        }
      }

      return {
        metadata: {
          width: info.width,
          height: info.height,
          geoKeys,
          bands: channels,
          pages: metadata.pages || 1,
        },
        rasters,
        bounds,
        originalBbox: bbox,
        sharpMetadata: metadata, // Include the original sharp metadata
      };
    } catch (error) {
      console.error(`Error in processWithSharp: ${error.message}`);

      // Fall back to geotiff.js processing
      console.log("Falling back to geotiff.js processing");
      return this.processWithGeotiff(buffer, options);
    }
  }

  /**
   * Extract a specific band/page from a multi-band/multi-page GeoTIFF
   * @param {Buffer} buffer - The GeoTIFF buffer
   * @param {number} bandIndex - The band/page index to extract
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Processed single-band GeoTIFF data
   */
  async extractBand(buffer, bandIndex, options = {}) {
    try {
      console.log(`Extracting band/page ${bandIndex} from GeoTIFF`);

      const useSharp = options.useSharp || false;

      if (useSharp) {
        // Use sharp to extract the specific page
        const sharpImg = sharp(buffer);
        const metadata = await sharpImg.metadata();

        if (bandIndex >= metadata.pages) {
          throw new Error(
            `Band index ${bandIndex} out of range (max: ${metadata.pages - 1})`
          );
        }

        return this.processWithSharp(buffer, {
          ...options,
          page: bandIndex,
        });
      } else {
        // Use geotiff.js to extract the specific band/sample
        return this.processWithGeotiff(buffer, {
          ...options,
          page: bandIndex,
          samples: [bandIndex],
        });
      }
    } catch (error) {
      console.error(`Error extracting band ${bandIndex}: ${error.message}`);
      throw new Error(`Failed to extract band ${bandIndex}: ${error.message}`);
    }
  }

  /**
   * Reproject bounding box to standard lat/lon coordinates
   * @param {Array<number>} bbox - The bounding box from GeoTIFF [west, south, east, north]
   * @param {Object} geoKeys - The GeoKeys from GeoTIFF
   * @returns {Object} - Reprojected bounds {north, south, east, west}
   */
  reprojectBounds(bbox, geoKeys) {
    try {
      // Convert GeoKeys to Proj4 projection string
      const projObj = geokeysToProj4.toProj4(geoKeys);

      // Create projection function for converting coordinates
      const projection = proj4(projObj.proj4, "WGS84");

      // Get coordinate conversion parameters
      const convParams = projObj.coordinatesConversionParameters || {
        x: 1,
        y: 1,
      };

      // Convert southwest and northeast corners to WGS84 (lat/lng)
      const sw = projection.forward({
        x: bbox[0] * convParams.x,
        y: bbox[1] * convParams.y,
      });

      const ne = projection.forward({
        x: bbox[2] * convParams.x,
        y: bbox[3] * convParams.y,
      });

      // Return bounds in standard lat/lng format
      return {
        north: ne.y,
        south: sw.y,
        east: ne.x,
        west: sw.x,
      };
    } catch (error) {
      console.error(`Error reprojecting bounds: ${error.message}`);

      // Return null or a placeholder if reprojection fails
      console.warn("Returning unprojected bounding box due to error");
      return {
        north: bbox[3],
        south: bbox[1],
        east: bbox[2],
        west: bbox[0],
      };
    }
  }

  /**
   * Find valid data range in the raster (ignoring no-data values)
   * @param {TypedArray|Array} raster - Raster data
   * @param {number} [noDataValue=-9999] - Value to ignore as no-data
   * @returns {Object} - Min and max values {min, max}
   */
  findDataRange(raster, noDataValue = -9999) {
    try {
      let min = Infinity;
      let max = -Infinity;

      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }

      // Check if we found any valid values
      if (min === Infinity || max === -Infinity) {
        console.warn("No valid data found in raster");
        return { min: 0, max: 1 }; // Default range
      }

      return { min, max };
    } catch (error) {
      console.error(`Error finding data range: ${error.message}`);
      return { min: 0, max: 1 }; // Default range
    }
  }
}

module.exports = GeoTiffProcessor;
