/**
 * Hourly shade layer processor for SolarScanner data-layers module
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for hourly shade layer data
 * @extends Processor
 */
class HourlyShadeProcessor extends Processor {
  /**
   * Create a new HourlyShadeProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[HourlyShadeProcessor] Initialized");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "hourlyShade";
  }

  /**
   * Process raw hourly shade data
   * @param {Object} rawData - The raw data object
   * @param {Object} options - Processing options
   * @param {Object} [options.targetLocation] - REQUIRED: Target location {latitude, longitude} for building detection
   * @returns {Promise<Object>} - Processed hourly shade data
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[HourlyShadeProcessor] Processing hourly shade data");

        // Validate target location for building detection
        if (!options.targetLocation) {
          throw new Error(
            "[HourlyShadeProcessor] targetLocation is required for building boundary detection. " +
              "This should be provided by the LayerManager."
          );
        }

        if (
          !options.targetLocation.latitude ||
          !options.targetLocation.longitude
        ) {
          throw new Error(
            "[HourlyShadeProcessor] targetLocation must have latitude and longitude properties. " +
              `Received: ${JSON.stringify(options.targetLocation)}`
          );
        }

        console.log(
          `[HourlyShadeProcessor] Using target location for building detection: ${options.targetLocation.latitude}, ${options.targetLocation.longitude}`
        );

        // Extract buffers from object or use raw buffer directly
        let hourlyShadeBuffer, maskBuffer, fetcherMetadata;

        if (
          rawData &&
          typeof rawData === "object" &&
          (rawData.hourlyShadeData || rawData.hourlyShadeBuffer)
        ) {
          hourlyShadeBuffer =
            rawData.hourlyShadeData || rawData.hourlyShadeBuffer;
          maskBuffer = rawData.maskData || rawData.maskBuffer;
          fetcherMetadata = rawData.metadata || {};
        } else {
          hourlyShadeBuffer = rawData;
          maskBuffer = null;
          fetcherMetadata = {};
        }

        // Validate hourly shade buffer
        if (!hourlyShadeBuffer) {
          throw new Error("Hourly shade data buffer is required");
        }

        // Ensure buffer is in the correct format
        this.validateRawData(hourlyShadeBuffer);

        // Set default options
        const buildingMargin =
          options.buildingMargin || config.visualization.BUILDING_MARGIN;
        const day = options.day || 15; // Default to middle of month
        const month = options.month !== undefined ? options.month : 0; // Default to January

        if (day < 1 || day > 31) {
          throw new Error(`Invalid day: ${day}. Must be between 1 and 31.`);
        }

        if (month < 0 || month > 11) {
          throw new Error(`Invalid month: ${month}. Must be between 0 and 11.`);
        }

        // Process the hourly shade GeoTIFF data
        const processedHourlyShadeGeoTiff = await this.geotiffProcessor.process(
          hourlyShadeBuffer,
          {
            convertToArray: true,
          }
        );

        // Extract metadata and rasters from the hourly shade data
        const {
          metadata: hourlyShadeMetadata,
          rasters: hourlyShadeRasters,
          bounds,
        } = processedHourlyShadeGeoTiff;

        // Validate that we have geographic bounds for coordinate transformation
        if (!bounds) {
          throw new Error(
            "[HourlyShadeProcessor] No geographic bounds found in hourly shade GeoTIFF. " +
              "Cannot perform coordinate transformation for targeted building detection."
          );
        }

        console.log(
          `[HourlyShadeProcessor] Hourly shade GeoTIFF bounds: ${JSON.stringify(
            bounds
          )}`
        );

        // Process mask data if available - REQUIRED for target building detection
        let maskRaster = null;
        let buildingBoundaries = null;
        let maskDimensions = null;

        if (maskBuffer) {
          try {
            console.log("[HourlyShadeProcessor] Processing mask data");

            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Get mask data
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            // Store mask with its original dimensions
            maskRaster = maskRasters[0];
            maskDimensions = {
              width: maskMetadata.width,
              height: maskMetadata.height,
            };

            // Check if mask dimensions match hourly shade dimensions
            if (
              maskMetadata.width !== hourlyShadeMetadata.width ||
              maskMetadata.height !== hourlyShadeMetadata.height
            ) {
              console.log(
                `[HourlyShadeProcessor] Mask dimensions (${maskMetadata.width}x${maskMetadata.height}) don't match hourly shade (${hourlyShadeMetadata.width}x${hourlyShadeMetadata.height}). Resampling...`
              );

              // Resample the mask to match hourly shade dimensions
              maskRaster = VisualizationUtils.resampleRaster(
                maskRaster,
                maskMetadata.width,
                maskMetadata.height,
                hourlyShadeMetadata.width,
                hourlyShadeMetadata.height,
                { method: "nearest" } // Use nearest neighbor for masks to preserve binary values
              );

              // Update mask dimensions to match resampled data
              maskDimensions = {
                width: hourlyShadeMetadata.width,
                height: hourlyShadeMetadata.height,
              };
            }

            // Extract building boundaries using targeted detection
            try {
              console.log(
                "[HourlyShadeProcessor] Finding target building boundaries..."
              );

              buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
                maskRaster,
                maskDimensions.width,
                maskDimensions.height,
                { margin: buildingMargin, threshold: 0 },
                options.targetLocation, // Target location for building detection
                bounds // Geographic bounds from GeoTIFF for coordinate transformation
              );

              if (buildingBoundaries.hasBuilding) {
                console.log(
                  `[HourlyShadeProcessor] Found target building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                );

                if (buildingBoundaries.targetBuilding) {
                  console.log(
                    `[HourlyShadeProcessor] Successfully detected target building with ${
                      buildingBoundaries.connectedPixelCount || "unknown"
                    } connected pixels`
                  );
                }
              } else {
                console.warn(
                  "[HourlyShadeProcessor] No target building found in mask data"
                );
              }
            } catch (error) {
              console.error(
                `[HourlyShadeProcessor] Error finding target building boundaries: ${error.message}`
              );

              // For the new approach, we want to fail rather than continue with defaults
              throw new Error(
                `Failed to find target building boundaries: ${error.message}`
              );
            }
          } catch (error) {
            console.error(
              `[HourlyShadeProcessor] Error processing mask: ${error.message}`
            );

            // For the new targeted approach, we should propagate the error
            throw new Error(
              `Failed to process mask data for target building detection: ${error.message}`
            );
          }
        } else {
          // No mask data available - this is a problem for the new approach
          throw new Error(
            "[HourlyShadeProcessor] Mask data is required for target building detection. " +
              "Cannot identify target building without mask data."
          );
        }

        // Apply day bit mask to each hourly raster
        const dayBitMask = 1 << (day - 1); // Create bit mask for the selected day
        const hourlyData = [];
        const hourCounts = [];

        // Process each hour's data
        for (let hour = 0; hour < hourlyShadeRasters.length; hour++) {
          const hourlyRaster = hourlyShadeRasters[hour];

          // Apply day bit mask to get binary yes/no values for sun at this hour
          const dayRaster = new Array(hourlyRaster.length);

          let nonZeroCount = 0;
          for (let i = 0; i < hourlyRaster.length; i++) {
            // The original value is a 32-bit integer where each bit represents a day
            // If bit for this day is set (1), sun is visible
            const sunVisible = hourlyRaster[i] & dayBitMask ? 1 : 0;
            dayRaster[i] = sunVisible;

            if (sunVisible > 0) {
              nonZeroCount++;
            }
          }

          hourCounts.push(nonZeroCount);

          // Create the hour data
          hourlyData.push({
            hour,
            hourLabel: this.formatHour(hour),
            raster: dayRaster,
            originalRaster: hourlyRaster,
          });
        }

        // Create the result object
        const result = {
          layerType: "hourlyShade",
          metadata: {
            ...hourlyShadeMetadata,
            ...fetcherMetadata,
            dimensions: {
              width: hourlyShadeMetadata.width,
              height: hourlyShadeMetadata.height,
            },
            maskDimensions: maskDimensions, // Include mask dimensions for the visualizer
            hours: hourlyShadeRasters.length,
            month,
            day,
            hasMask: !!maskRaster,
            targetLocation: options.targetLocation,
            targetBuildingDetected: buildingBoundaries?.targetBuilding || false,
          },
          hourlyData,
          bounds,
          buildingBoundaries,
          maskRaster,
        };

        console.log("[HourlyShadeProcessor] Hourly shade processing complete");
        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "hourlyShade",
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
   * Format hour for display (12-hour format with am/pm)
   * @private
   * @param {number} hour - Hour in 24-hour format (0-23)
   * @returns {string} - Formatted hour string
   */
  formatHour(hour) {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  }
}

module.exports = HourlyShadeProcessor;
