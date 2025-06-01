/**
 * RGB layer processor for SolarScanner data-layers module
 *
 * Processes raw RGB layer data from GeoTIFF format into a structured
 * representation, including building boundary information and proper cropping.
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
   * @param {Object} [options.targetLocation] - REQUIRED: Target location {latitude, longitude} for building detection
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=0] - Margin to add around building boundaries
   * @param {boolean} [options.cropToBuilding=true] - Whether to crop to building boundaries
   * @param {Object} [options.targetDimensions] - Target dimensions to resample to
   * @returns {Promise<Object>} - Processed RGB data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[RgbProcessor] Processing RGB data");

        // Validate target location for building detection
        if (!options.targetLocation) {
          throw new Error(
            "[RgbProcessor] targetLocation is required for building boundary detection. " +
              "This should be provided by the LayerManager."
          );
        }

        if (
          !options.targetLocation.latitude ||
          !options.targetLocation.longitude
        ) {
          throw new Error(
            "[RgbProcessor] targetLocation must have latitude and longitude properties. " +
              `Received: ${JSON.stringify(options.targetLocation)}`
          );
        }

        console.log(
          `[RgbProcessor] Using target location for building detection: ${options.targetLocation.latitude}, ${options.targetLocation.longitude}`
        );

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
        const cropEnabled = options.cropToBuilding !== false; // Crop by default unless explicitly disabled

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

        // Validate that we have geographic bounds for coordinate transformation
        if (!bounds) {
          throw new Error(
            "[RgbProcessor] No geographic bounds found in RGB GeoTIFF. " +
              "Cannot perform coordinate transformation for targeted building detection."
          );
        }

        console.log(
          `[RgbProcessor] RGB GeoTIFF bounds: ${JSON.stringify(bounds)}`
        );

        // Get original dimensions
        const width = rgbMetadata.width;
        const height = rgbMetadata.height;

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
                `[RgbProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match RGB (${width}x${height}). Resampling...`
              );

              // Resample the mask to match RGB dimensions
              maskRaster = VisualizationUtils.resampleRaster(
                maskRasters[0],
                maskMetadata.width,
                maskMetadata.height,
                width,
                height,
                { method: "nearest" } // Use nearest neighbor for masks to preserve binary values
              );
            } else {
              maskRaster = maskRasters[0];
            }

            // Extract building boundaries using targeted detection
            try {
              console.log(
                "[RgbProcessor] Finding target building boundaries..."
              );

              buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                maskRaster,
                width,
                height,
                { margin: buildingMargin, threshold: 0 },
                options.targetLocation, // Target location for building detection
                bounds // Geographic bounds from GeoTIFF for coordinate transformation
              );

              if (buildingBoundaries.hasBuilding) {
                console.log(
                  `[RgbProcessor] Found target building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                );

                if (buildingBoundaries.targetBuilding) {
                  console.log(
                    `[RgbProcessor] Successfully detected target building with ${
                      buildingBoundaries.connectedPixelCount || "unknown"
                    } connected pixels`
                  );
                }
              } else {
                console.warn(
                  "[RgbProcessor] No target building found in mask data"
                );
              }
            } catch (error) {
              console.error(
                `[RgbProcessor] Error finding target building boundaries: ${error.message}`
              );

              // For the new approach, we want to fail rather than continue with defaults
              // This ensures we get clear feedback about what needs to be fixed
              throw new Error(
                `Failed to find target building boundaries: ${error.message}`
              );
            }
          } catch (error) {
            console.error(
              `[RgbProcessor] Failed to process mask data: ${error.message}`
            );

            // For the new targeted approach, we should propagate the error
            // rather than falling back to defaults
            throw new Error(
              `Failed to process mask data for target building detection: ${error.message}`
            );
          }
        } else {
          // No mask data available - this is a problem for the new approach
          throw new Error(
            "[RgbProcessor] Mask data is required for target building detection. " +
              "Cannot identify target building without mask data."
          );
        }

        // Check if we need to resample to target dimensions
        if (
          options.targetDimensions &&
          (options.targetDimensions.width !== width ||
            options.targetDimensions.height !== height)
        ) {
          console.log(
            `[RgbProcessor] Resampling to target dimensions: ${options.targetDimensions.width}x${options.targetDimensions.height}`
          );

          // Resample each RGB channel
          let resampledRgbRasters = [];
          for (let band = 0; band < rgbRasters.length; band++) {
            resampledRgbRasters.push(
              VisualizationUtils.resampleRaster(
                rgbRasters[band],
                width,
                height,
                options.targetDimensions.width,
                options.targetDimensions.height,
                { method: "bilinear" }
              )
            );
          }

          // Resample mask raster if available
          let resampledMaskRaster = null;
          if (maskRaster) {
            resampledMaskRaster = VisualizationUtils.resampleRaster(
              maskRaster,
              width,
              height,
              options.targetDimensions.width,
              options.targetDimensions.height,
              { method: "nearest" } // Use nearest for mask to preserve binary values
            );
          }

          // Update variables with resampled data
          rgbRasters = resampledRgbRasters;
          maskRaster = resampledMaskRaster;

          // Also update dimensions
          const oldWidth = width;
          const oldHeight = height;
          const newWidth = options.targetDimensions.width;
          const newHeight = options.targetDimensions.height;

          // Scale building boundaries to new dimensions
          if (buildingBoundaries) {
            const scaleX = newWidth / oldWidth;
            const scaleY = newHeight / oldHeight;

            buildingBoundaries = {
              minX: Math.floor(buildingBoundaries.minX * scaleX),
              minY: Math.floor(buildingBoundaries.minY * scaleY),
              maxX: Math.ceil(buildingBoundaries.maxX * scaleX),
              maxY: Math.ceil(buildingBoundaries.maxY * scaleY),
              width: Math.ceil(buildingBoundaries.width * scaleX),
              height: Math.ceil(buildingBoundaries.height * scaleY),
              hasBuilding: buildingBoundaries.hasBuilding,
              targetBuilding: buildingBoundaries.targetBuilding,
              connectedPixelCount: buildingBoundaries.connectedPixelCount,
            };

            console.log(
              `[RgbProcessor] Building boundaries scaled to new dimensions: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
            );
          }
        }

        // Determine current dimensions (after potential resampling)
        let currentWidth = options.targetDimensions
          ? options.targetDimensions.width
          : width;
        let currentHeight = options.targetDimensions
          ? options.targetDimensions.height
          : height;

        // Crop RGB and mask data to building boundaries if requested
        let croppedRgbRasters = rgbRasters;
        let croppedMaskRaster = maskRaster;
        let croppedWidth = currentWidth;
        let croppedHeight = currentHeight;
        let croppedBounds = bounds;

        if (
          cropEnabled &&
          buildingBoundaries &&
          buildingBoundaries.hasBuilding
        ) {
          console.log(
            "[RgbProcessor] Cropping data to target building boundaries"
          );

          // Use the centralized utility for cropping multi-band rasters
          const cropResult = VisualizationUtils.cropRastersToBuilding(
            rgbRasters,
            maskRaster,
            currentWidth,
            currentHeight,
            buildingBoundaries
          );

          croppedRgbRasters = cropResult.croppedRasters;
          croppedMaskRaster = cropResult.croppedMaskRaster;
          croppedWidth = buildingBoundaries.width;
          croppedHeight = buildingBoundaries.height;

          console.log(
            `[RgbProcessor] Data cropped from ${currentWidth}x${currentHeight} to ${croppedWidth}x${croppedHeight}`
          );

          // Adjust bounds to reflect the cropped area
          croppedBounds = VisualizationUtils.adjustBoundsToBuilding(
            bounds,
            currentWidth,
            currentHeight,
            buildingBoundaries
          );

          // Update building boundaries to be relative to the cropped image
          buildingBoundaries =
            VisualizationUtils.normalizeBuilding(buildingBoundaries);
        } else {
          console.log("[RgbProcessor] Data not cropped - using full raster");
        }

        // Create the result object
        const result = {
          layerType: "rgb",
          metadata: {
            ...rgbMetadata,
            ...fetcherMetadata,
            dimensions: {
              width: croppedWidth,
              height: croppedHeight,
              originalWidth: width,
              originalHeight: height,
            },
            bands: croppedRgbRasters.length,
            hasMask: !!croppedMaskRaster,
            targetLocation: options.targetLocation,
            targetBuildingDetected: buildingBoundaries?.targetBuilding || false,
            buildingBoundaries: buildingBoundaries
              ? {
                  exists: buildingBoundaries.hasBuilding,
                  width: buildingBoundaries.width,
                  height: buildingBoundaries.height,
                }
              : null,
          },
          rasters: croppedRgbRasters,
          bounds: croppedBounds,
          buildingBoundaries,
          maskRaster: croppedMaskRaster,
        };

        console.log("[RgbProcessor] RGB processing complete");

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "rgb",
        options: {
          ...options,
          targetLocation: options.targetLocation
            ? "[LOCATION PROVIDED]"
            : "[NO LOCATION]",
        },
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
