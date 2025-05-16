/**
 * RGB layer processor for SolarScanner data-layers module
 *
 * Processes raw RGB layer data from GeoTIFF format into a structured
 * representation, including building boundary information.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for RGB layer data
 * @extends Processor
 */
class RgbProcessor extends Processor {
  /**
   * Create a new RgbProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[RgbProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "rgb";
  }

  /**
   * Process raw RGB data
   * @param {Object} rawData - The raw data object containing RGB data and optional mask data
   * @param {Buffer} rawData.rgbData - The raw RGB data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=0] - Margin to add around building boundaries
   * @returns {Promise<Object>} - Processed RGB data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[RgbProcessor] Processing RGB data");

        // Check if we have a combined object with both RGB and mask data
        const isRawObject =
          rawData &&
          typeof rawData === "object" &&
          (rawData.rgbData || rawData.rgbBuffer);

        // Extract buffers from object or use raw buffer directly
        let rgbBuffer, maskBuffer, fetcherMetadata;

        if (isRawObject) {
          // Data is an object with embedded buffers and metadata
          rgbBuffer = rawData.rgbData || rawData.rgbBuffer;
          maskBuffer = rawData.maskData || rawData.maskBuffer;
          fetcherMetadata = rawData.metadata || {};

          console.log(
            `[RgbProcessor] Received data object with RGB buffer (${
              rgbBuffer ? "present" : "missing"
            }) and mask buffer (${maskBuffer ? "present" : "missing"})`
          );
        } else {
          // Direct buffer (although this case may not handle mask data)
          rgbBuffer = rawData;
          maskBuffer = null;
          fetcherMetadata = {};

          console.log(`[RgbProcessor] Received direct buffer data`);
        }

        // Validate RGB buffer
        if (!rgbBuffer) {
          throw new Error("RGB data buffer is required");
        }

        // Log buffer details
        console.log(
          `[RgbProcessor] RGB buffer type: ${typeof rgbBuffer}, length: ${
            rgbBuffer.byteLength || rgbBuffer.length || "unknown"
          }`
        );

        // Ensure buffer is in the correct format
        this.validateRawData(rgbBuffer);

        // Set default options
        const useMask = options.useMask !== false && maskBuffer;
        const buildingMargin = options.buildingMargin || 0; // Ensure margin is 0 by default

        // Process the RGB GeoTIFF data
        let processedRgbGeoTiff;
        try {
          processedRgbGeoTiff = await this.geotiffProcessor.process(rgbBuffer, {
            convertToArray: true,
            // We want all 3 RGB bands
          });

          console.log(
            `[RgbProcessor] RGB GeoTIFF processed: ${processedRgbGeoTiff.metadata.width}x${processedRgbGeoTiff.metadata.height} pixels, ${processedRgbGeoTiff.rasters.length} bands`
          );

          // Validate RGB data
          this.validateRgbData(processedRgbGeoTiff.rasters);
        } catch (error) {
          throw new Error(`Failed to process RGB GeoTIFF: ${error.message}`);
        }

        // Extract metadata and rasters from the RGB data
        const {
          metadata: rgbMetadata,
          rasters: rgbRasters,
          bounds,
        } = processedRgbGeoTiff;

        // Process mask data if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (useMask && maskBuffer) {
          try {
            console.log("[RgbProcessor] Processing mask data");

            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Check if mask dimensions match RGB dimensions
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            if (
              maskMetadata.width !== rgbMetadata.width ||
              maskMetadata.height !== rgbMetadata.height
            ) {
              console.warn(
                "[RgbProcessor] Mask and RGB dimensions do not match. Mask will not be applied."
              );
            } else {
              maskRaster = maskRasters[0];

              // Extract building boundaries
              try {
                buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                  maskRaster,
                  maskMetadata.width,
                  maskMetadata.height,
                  { margin: buildingMargin }
                );

                if (buildingBoundaries.hasBuilding) {
                  console.log(
                    `[RgbProcessor] Found building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                  );
                } else {
                  console.warn("[RgbProcessor] No building found in mask data");
                }
              } catch (error) {
                console.error(
                  `[RgbProcessor] Error finding building boundaries: ${error.message}`
                );
              }
            }
          } catch (error) {
            console.warn(
              `[RgbProcessor] Failed to process mask data: ${error.message}`
            );
            // Continue without mask data
          }
        }

        // Determine dimensions based on building boundaries if available
        let dimensions = {
          width: rgbMetadata.width,
          height: rgbMetadata.height,
        };

        // If building boundaries are available, use them for dimensions
        if (buildingBoundaries && buildingBoundaries.hasBuilding) {
          dimensions = {
            width: buildingBoundaries.width,
            height: buildingBoundaries.height,
          };

          console.log(
            `[RgbProcessor] Using building dimensions: ${dimensions.width}x${dimensions.height}`
          );
        }

        // Create the result object
        const result = {
          layerType: "rgb",
          metadata: {
            ...rgbMetadata,
            ...fetcherMetadata,
            dimensions, // Use building dimensions if available
            fullDimensions: {
              width: rgbMetadata.width,
              height: rgbMetadata.height,
            }, // Keep the original full dimensions
            bands: rgbRasters.length,
            hasMask: !!maskRaster,
          },
          rasters: rgbRasters,
          bounds,
          buildingBoundaries,
          maskRaster,
        };

        console.log("[RgbProcessor] RGB processing complete");

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "rgb",
        options,
      });
    }
  }

  /**
   * Simple validation to ensure the RGB data has 3 channels
   * @private
   * @param {Array<Array<number>>} rasters - RGB raster data
   * @throws {Error} if validation fails
   */
  validateRgbData(rasters) {
    if (!Array.isArray(rasters)) {
      throw new Error("RGB rasters must be an array");
    }

    if (rasters.length !== 3) {
      throw new Error(
        `Expected 3 rasters for RGB data, found ${rasters.length}`
      );
    }

    for (let i = 0; i < rasters.length; i++) {
      if (!Array.isArray(rasters[i]) && !ArrayBuffer.isView(rasters[i])) {
        throw new Error(`Raster ${i} is not an array or typed array`);
      }

      if (rasters[i].length === 0) {
        throw new Error(`Raster ${i} is empty`);
      }
    }

    // Check if all rasters have the same length
    const length = rasters[0].length;
    for (let i = 1; i < rasters.length; i++) {
      if (rasters[i].length !== length) {
        throw new Error(
          `Raster length mismatch: ${rasters[i].length} vs ${length}`
        );
      }
    }
  }
}

module.exports = RgbProcessor;
