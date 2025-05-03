/**
 * Monthly flux layer processor for SolarScanner data-layers module
 *
 * Processes raw monthly flux layer data from GeoTIFF format into a structured
 * representation, extracting data for all 12 months.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");
const config = require("../../config");

/**
 * Processor implementation for monthly flux layer data
 * @extends Processor
 */
class MonthlyFluxProcessor extends Processor {
  /**
   * Create a new MonthlyFluxProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[MonthlyFluxProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "monthlyFlux";
  }

  /**
   * Process raw monthly flux data
   * @param {Object} rawData - The raw data object containing monthly flux data and optional mask data
   * @param {Buffer} rawData.monthlyFluxData - The raw monthly flux data buffer
   * @param {Buffer} [rawData.maskData] - The raw mask data buffer (optional)
   * @param {Object} [rawData.metadata] - Additional metadata from the fetcher
   * @param {Object} options - Processing options
   * @param {boolean} [options.processAllMonths=true] - Whether to process all 12 months
   * @param {boolean} [options.useMask=true] - Whether to use mask data if available
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {boolean} [options.calculateStatistics=true] - Whether to calculate statistics for each month
   * @returns {Promise<Object>} - Processed monthly flux data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[MonthlyFluxProcessor] Processing monthly flux data");

        // Check if we have a combined object with both monthly flux and mask data
        const isRawObject =
          rawData &&
          typeof rawData === "object" &&
          (rawData.monthlyFluxData || rawData.fluxBuffer);

        // Extract buffers from object or use raw buffer directly
        const fluxBuffer = isRawObject
          ? rawData.monthlyFluxData || rawData.fluxBuffer
          : rawData;
        const maskBuffer = isRawObject
          ? rawData.maskData || rawData.maskBuffer
          : null;
        const fetcherMetadata = isRawObject ? rawData.metadata || {} : {};

        // Validate flux buffer
        if (!fluxBuffer) {
          throw new Error("Monthly flux data buffer is required");
        }
        this.validateRawData(fluxBuffer);

        // Set default options
        const processAllMonths = options.processAllMonths !== false;
        const useMask = options.useMask !== false && maskBuffer;
        const buildingMargin =
          options.buildingMargin || config.visualization.BUILDING_MARGIN;
        const calculateStatistics = options.calculateStatistics !== false;

        // Process the monthly flux GeoTIFF data
        let processedFluxGeoTiff;
        try {
          processedFluxGeoTiff = await this.geotiffProcessor.process(
            fluxBuffer,
            {
              convertToArray: true,
              // Don't specify samples as we want all bands
            }
          );

          console.log(
            `[MonthlyFluxProcessor] Monthly flux GeoTIFF processed: ${processedFluxGeoTiff.metadata.width}x${processedFluxGeoTiff.metadata.height} pixels, ${processedFluxGeoTiff.rasters.length} bands`
          );
        } catch (error) {
          throw new Error(
            `Failed to process monthly flux GeoTIFF: ${error.message}`
          );
        }

        // Extract metadata and rasters from the flux data
        const {
          metadata: fluxMetadata,
          rasters: fluxRasters,
          bounds,
        } = processedFluxGeoTiff;

        // Check for expected 12 bands for monthly data
        if (fluxRasters.length !== 12) {
          console.warn(
            `[MonthlyFluxProcessor] Expected 12 bands for monthly flux data, but found ${fluxRasters.length}`
          );
        }

        // Process mask data if available
        let maskRaster = null;
        let buildingBoundaries = null;

        if (useMask && maskBuffer) {
          try {
            console.log("[MonthlyFluxProcessor] Processing mask data");

            const processedMaskGeoTiff = await this.geotiffProcessor.process(
              maskBuffer,
              {
                convertToArray: true,
                page: 0,
              }
            );

            // Check if mask dimensions match flux dimensions
            const { metadata: maskMetadata, rasters: maskRasters } =
              processedMaskGeoTiff;

            if (
              maskMetadata.width !== fluxMetadata.width ||
              maskMetadata.height !== fluxMetadata.height
            ) {
              console.warn(
                "[MonthlyFluxProcessor] Mask and flux dimensions do not match. Mask will not be applied."
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
                    `[MonthlyFluxProcessor] Found building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
                  );
                } else {
                  console.warn(
                    "[MonthlyFluxProcessor] No building found in mask data"
                  );
                }
              } catch (error) {
                console.error(
                  `[MonthlyFluxProcessor] Error finding building boundaries: ${error.message}`
                );
              }
            }
          } catch (error) {
            console.warn(
              `[MonthlyFluxProcessor] Failed to process mask data: ${error.message}`
            );
            // Continue without mask data
          }
        }

        // Check for no-data values and find valid data range
        const noDataValue = config.processing.NO_DATA_VALUE;
        const dataRanges = [];

        for (let month = 0; month < fluxRasters.length; month++) {
          if (calculateStatistics) {
            dataRanges.push(
              this.findDataRange(fluxRasters[month], noDataValue)
            );
          }
        }

        // Process each month's data
        const monthlyData = [];

        // Process all months or specified months only
        const monthsToProcess = processAllMonths
          ? Array.from({ length: fluxRasters.length }, (_, i) => i)
          : [options.month || 0];

        for (const month of monthsToProcess) {
          // Skip if month is out of range
          if (month < 0 || month >= fluxRasters.length) {
            console.warn(
              `[MonthlyFluxProcessor] Month ${month} is out of range (0-${
                fluxRasters.length - 1
              })`
            );
            continue;
          }

          const raster = fluxRasters[month];

          // Apply mask if available
          let maskedRaster = raster;
          if (maskRaster) {
            maskedRaster = this.applyMask(
              raster,
              maskRaster,
              fluxMetadata.width,
              fluxMetadata.height
            );
          }

          // Calculate statistics if requested
          let statistics = null;
          if (calculateStatistics) {
            statistics = this.calculateStatistics(
              maskedRaster,
              month,
              dataRanges[month]
            );
          }

          // Create the month data
          monthlyData.push({
            month,
            monthName: this.getMonthName(month),
            raster: maskedRaster,
            originalRaster: raster,
            statistics,
            dataRange: dataRanges[month] || null,
            seasonalFactor: VisualizationUtils.getSeasonalFactor(month),
          });
        }

        // Create the result object
        const result = {
          layerType: "monthlyFlux",
          metadata: {
            ...fluxMetadata,
            ...fetcherMetadata,
            dimensions: {
              width: fluxMetadata.width,
              height: fluxMetadata.height,
            },
            months: fluxRasters.length,
            hasMask: !!maskRaster,
            noDataValue,
          },
          monthlyData,
          bounds,
          buildingBoundaries,
          maskRaster,
        };

        console.log("[MonthlyFluxProcessor] Monthly flux processing complete");

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "monthlyFlux",
        options,
      });
    }
  }

  /**
   * Find valid data range in a raster
   * @private
   * @param {Array<number>} raster - Raster data
   * @param {number} noDataValue - Value to ignore as no-data
   * @returns {Object} - Min and max values {min, max}
   */
  findDataRange(raster, noDataValue) {
    try {
      let min = Infinity;
      let max = -Infinity;
      let validCount = 0;
      let sum = 0;

      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
          sum += value;
          validCount++;
        }
      }

      // Check if we found any valid values
      if (validCount === 0) {
        console.warn("[MonthlyFluxProcessor] No valid data found in raster");
        return { min: 0, max: 1, avg: 0, validCount: 0 };
      }

      return {
        min,
        max,
        avg: sum / validCount,
        validCount,
      };
    } catch (error) {
      console.error(
        `[MonthlyFluxProcessor] Error finding data range: ${error.message}`
      );
      return { min: 0, max: 1, avg: 0, validCount: 0, error: error.message };
    }
  }

  /**
   * Apply mask to flux data
   * @private
   * @param {Array<number>} fluxRaster - Flux raster data
   * @param {Array<number>} maskRaster - Mask raster data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {Array<number>} - Masked flux data
   */
  applyMask(fluxRaster, maskRaster, width, height) {
    try {
      const maskedRaster = new Array(fluxRaster.length);
      const noDataValue = config.processing.NO_DATA_VALUE;

      for (let i = 0; i < fluxRaster.length; i++) {
        // If mask is 0, set flux to no data value
        maskedRaster[i] = maskRaster[i] > 0 ? fluxRaster[i] : noDataValue;
      }

      return maskedRaster;
    } catch (error) {
      console.error(
        `[MonthlyFluxProcessor] Error applying mask: ${error.message}`
      );
      return fluxRaster; // Return original raster if masking fails
    }
  }

  /**
   * Calculate statistics for a monthly raster
   * @private
   * @param {Array<number>} raster - Masked flux raster data
   * @param {number} month - Month index (0-11)
   * @param {Object} dataRange - Data range {min, max}
   * @returns {Object} - Statistics for the month
   */
  calculateStatistics(raster, month, dataRange) {
    try {
      const noDataValue = config.processing.NO_DATA_VALUE;
      let sum = 0;
      let count = 0;
      let maxValue = -Infinity;
      let maxLocation = -1;

      // Calculate sum and find maximum
      for (let i = 0; i < raster.length; i++) {
        const value = raster[i];
        if (value !== noDataValue && !isNaN(value)) {
          sum += value;
          count++;

          if (value > maxValue) {
            maxValue = value;
            maxLocation = i;
          }
        }
      }

      // Calculate average
      const avg = count > 0 ? sum / count : 0;

      // Get seasonal adjustment factor
      const seasonalFactor = VisualizationUtils.getSeasonalFactor(month);

      return {
        month,
        monthName: this.getMonthName(month),
        average: avg,
        max: maxValue,
        maxLocation,
        validPixels: count,
        seasonalFactor,
        seasonalAdjustedAvg: avg * seasonalFactor,
        min: dataRange ? dataRange.min : 0,
        dataPoints: count,
      };
    } catch (error) {
      console.error(
        `[MonthlyFluxProcessor] Error calculating statistics: ${error.message}`
      );
      return {
        month,
        monthName: this.getMonthName(month),
        error: error.message,
      };
    }
  }

  /**
   * Get month name from index
   * @private
   * @param {number} month - Month index (0-11)
   * @returns {string} - Month name
   */
  getMonthName(month) {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Handle invalid month index
    if (month < 0 || month >= monthNames.length) {
      console.warn(`[MonthlyFluxProcessor] Invalid month index: ${month}`);
      return `Month ${month}`;
    }

    return monthNames[month];
  }
}

module.exports = MonthlyFluxProcessor;
