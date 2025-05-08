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
   * @returns {Promise<Object>} - Processed hourly shade data
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
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
        const useMask = options.useMask !== false && maskBuffer;
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

        // Process mask data if available
        let maskRaster = null;
        let buildingBoundaries = null;
        let maskDimensions = null;

        if (useMask && maskBuffer) {
          try {
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

            // Extract building boundaries using the original mask dimensions
            buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
              maskRaster,
              maskMetadata.width,
              maskMetadata.height,
              { margin: buildingMargin, threshold: 0 }
            );
          } catch (error) {
            console.warn(
              `[HourlyShadeProcessor] Mask processing failed: ${error.message}`
            );
            // Continue without mask data
          }
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
          },
          hourlyData,
          bounds,
          buildingBoundaries,
          maskRaster,
        };

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
