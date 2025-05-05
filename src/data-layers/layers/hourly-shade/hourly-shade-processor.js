/**
 * Hourly shade layer processor for SolarScanner data-layers module
 *
 * Processes raw hourly shade layer data from GeoTIFF format into a structured
 * representation, extracting data for all 24 hours of the day.
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
    console.log("[HourlyShadeProcessor] Initialized with GeoTiffProcessor");
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
   * @param {Object} rawData - The raw data object containing hourly shade data and optional mask data
   * @param {Buffer} rawData.hourlyShadeData - The raw hourly shade data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {number} [options.day=15] - Day of month (1-31 depending on month)
   * @returns {Promise<Object>} - Processed hourly shade data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[HourlyShadeProcessor] Processing hourly shade data");

        // Check if we have a combined object with both hourly shade and mask data
        const isRawObject =
          rawData &&
          typeof rawData === "object" &&
          (rawData.hourlyShadeData || rawData.hourlyShadeBuffer);

        // Extract buffers from object or use raw buffer directly
        let hourlyShadeBuffer, maskBuffer, fetcherMetadata;

        if (isRawObject) {
          // Data is an object with embedded buffers and metadata
          hourlyShadeBuffer =
            rawData.hourlyShadeData || rawData.hourlyShadeBuffer;
          maskBuffer = rawData.maskData || rawData.maskBuffer;
          fetcherMetadata = rawData.metadata || {};

          console.log(
            `[HourlyShadeProcessor] Received data object with hourly shade buffer (${
              hourlyShadeBuffer ? "present" : "missing"
            }) and mask buffer (${maskBuffer ? "present" : "missing"})`
          );
        } else {
          // Direct buffer (although this case may not handle mask data)
          hourlyShadeBuffer = rawData;
          maskBuffer = null;
          fetcherMetadata = {};

          console.log(`[HourlyShadeProcessor] Received direct buffer data`);
        }

        // Validate hourly shade buffer
        if (!hourlyShadeBuffer) {
          throw new Error("Hourly shade data buffer is required");
        }

        // Log buffer details
        console.log(
          `[HourlyShadeProcessor] Hourly shade buffer type: ${typeof hourlyShadeBuffer}, length: ${
            hourlyShadeBuffer.byteLength ||
            hourlyShadeBuffer.length ||
            "unknown"
          }`
        );

        // Ensure buffer is in the correct format
        this.validateRawData(hourlyShadeBuffer);

        // Set default options
        const useMask = options.useMask !== false && maskBuffer;
        const buildingMargin =
          options.buildingMargin || config.visualization.BUILDING_MARGIN;
        const day = options.day || 15; // Default to middle of month

        if (day < 1 || day > 31) {
          throw new Error(`Invalid day: ${day}. Must be between 1 and 31.`);
        }

        // Process the hourly shade GeoTIFF data
        let processedHourlyShadeGeoTiff;
        try {
          processedHourlyShadeGeoTiff = await this.geotiffProcessor.process(
            hourlyShadeBuffer,
            {
              convertToArray: true,
              // Don't specify samples as we want all 24 bands (one per hour)
            }
          );

          console.log(
            `[HourlyShadeProcessor] Hourly shade GeoTIFF processed: ${processedHourlyShadeGeoTiff.metadata.width}x${processedHourlyShadeGeoTiff.metadata.height} pixels, ${processedHourlyShadeGeoTiff.rasters.length} bands`
          );

          // Validate that we have hourly data (24 bands)
          if (processedHourlyShadeGeoTiff.rasters.length !== 24) {
            console.warn(
              `[HourlyShadeProcessor] Expected 24 bands for hourly data, but found ${processedHourlyShadeGeoTiff.rasters.length}`
            );
          }
        } catch (error) {
          throw new Error(
            `Failed to process hourly shade GeoTIFF: ${error.message}`
          );
        }

        // Extract metadata and rasters from the hourly shade data
        const {
          metadata: hourlyShadeMetadata,
          rasters: hourlyShadeRasters,
          bounds,
        } = processedHourlyShadeGeoTiff;

        // Process mask data if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (useMask && maskBuffer) {
          try {
            console.log("[HourlyShadeProcessor] Processing mask data");

            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Check if mask dimensions match hourly shade dimensions
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            if (
              maskMetadata.width !== hourlyShadeMetadata.width ||
              maskMetadata.height !== hourlyShadeMetadata.height
            ) {
              console.warn(
                "[HourlyShadeProcessor] Mask and hourly shade dimensions do not match. Mask will not be applied."
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
                    `[HourlyShadeProcessor] Found building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                  );
                } else {
                  console.warn(
                    "[HourlyShadeProcessor] No building found in mask data"
                  );
                }
              } catch (error) {
                console.error(
                  `[HourlyShadeProcessor] Error finding building boundaries: ${error.message}`
                );
              }
            }
          } catch (error) {
            console.warn(
              `[HourlyShadeProcessor] Failed to process mask data: ${error.message}`
            );
            // Continue without mask data
          }
        }

        // Apply day bit mask to each hourly raster
        const dayBitMask = 1 << (day - 1); // Create bit mask for the selected day
        console.log(
          `[HourlyShadeProcessor] Using day bit mask: ${dayBitMask} for day ${day}`
        );

        const hourlyData = [];

        // Process each hour's data
        for (let hour = 0; hour < hourlyShadeRasters.length; hour++) {
          const hourlyRaster = hourlyShadeRasters[hour];

          // Apply day bit mask to get binary yes/no values for sun at this hour
          const dayRaster = new Array(hourlyRaster.length);
          for (let i = 0; i < hourlyRaster.length; i++) {
            // If bit for this day is set (1), sun is visible
            dayRaster[i] = hourlyRaster[i] & dayBitMask ? 1 : 0;
          }

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
            hours: hourlyShadeRasters.length,
            day,
            hasMask: !!maskRaster,
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
        options,
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
