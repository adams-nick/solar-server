/**
 * Mask layer processor for SolarScanner data-layers module
 *
 * Processes raw mask layer data from GeoTIFF format into a structured
 * representation, including building boundary information.
 */

const Processor = require("../../core/processor");
const GeoTiffProcessor = require("../../utils/geotiff-processor");
const VisualizationUtils = require("../../utils/visualization-utils");

/**
 * Processor implementation for mask layer data
 * @extends Processor
 */
class MaskProcessor extends Processor {
  /**
   * Create a new MaskProcessor
   */
  constructor() {
    super();
    this.geotiffProcessor = new GeoTiffProcessor();
    console.log("[MaskProcessor] Initialized with GeoTiffProcessor");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "mask";
  }

  /**
   * Process raw mask data
   * @param {Buffer} rawData - The raw mask data buffer
   * @param {Object} options - Processing options
   * @param {boolean} [options.convertToArray=false] - Whether to convert TypedArrays to regular arrays
   * @param {boolean} [options.findBuildingBoundaries=true] - Whether to extract building boundaries
   * @param {number} [options.buildingMargin=20] - Margin to add around building boundaries
   * @param {number} [options.threshold=0] - Threshold for mask values (pixels above this are buildings)
   * @returns {Promise<Object>} - Processed mask data
   * @throws {Error} if processing fails
   */
  async process(rawData, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[MaskProcessor] Processing mask data");

        // Validate raw data
        this.validateRawData(rawData);

        // Set default options
        const convertToArray = options.convertToArray || false;
        const findBuildingBoundaries = options.findBuildingBoundaries !== false;
        const buildingMargin = options.buildingMargin || 20;
        const threshold = options.threshold || 0;

        // Process the GeoTIFF data
        let processedGeoTiff;
        try {
          processedGeoTiff = await this.geotiffProcessor.process(rawData, {
            convertToArray,
            page: 0, // Only first page/band for mask
          });

          console.log(
            `[MaskProcessor] GeoTIFF processed: ${processedGeoTiff.metadata.width}x${processedGeoTiff.metadata.height} pixels`
          );
        } catch (error) {
          throw new Error(`Failed to process mask GeoTIFF: ${error.message}`);
        }

        // Extract metadata and rasters
        const { metadata, rasters, bounds } = processedGeoTiff;

        // Ensure we have at least one raster
        if (!rasters || rasters.length === 0) {
          throw new Error("No raster data found in mask GeoTIFF");
        }

        // The mask is the first (and typically only) raster
        const maskRaster = rasters[0];

        // Calculate mask statistics
        const stats = this.calculateMaskStatistics(maskRaster, threshold);

        // Extract building boundaries if requested
        let buildingBoundaries = null;
        if (findBuildingBoundaries) {
          try {
            buildingBoundaries = VisualizationUtils.findBuildingBoundaries(
              maskRaster,
              metadata.width,
              metadata.height,
              { margin: buildingMargin, threshold }
            );

            if (buildingBoundaries.hasBuilding) {
              console.log(
                `[MaskProcessor] Found building boundaries: (${buildingBoundaries.minX},${buildingBoundaries.minY}) to (${buildingBoundaries.maxX},${buildingBoundaries.maxY})`
              );
            } else {
              console.warn("[MaskProcessor] No building found in mask data");
            }
          } catch (error) {
            console.error(
              `[MaskProcessor] Error finding building boundaries: ${error.message}`
            );
            // Continue processing even if building boundary extraction fails
          }
        }

        // Create the result object
        const result = {
          layerType: "mask",
          metadata: {
            ...metadata,
            stats,
            hasMask: stats.buildingPixels > 0,
            threshold,
          },
          raster: maskRaster,
          bounds,
          buildingBoundaries,
        };

        console.log("[MaskProcessor] Mask processing complete");

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "mask",
        options,
      });
    }
  }

  /**
   * Calculate statistics for the mask data
   * @private
   * @param {TypedArray|Array} maskRaster - Mask raster data
   * @param {number} threshold - Threshold for mask values
   * @returns {Object} - Mask statistics
   */
  calculateMaskStatistics(maskRaster, threshold) {
    try {
      let totalPixels = maskRaster.length;
      let buildingPixels = 0;
      let maxValue = -Infinity;
      let minValue = Infinity;
      let sum = 0;

      // Scan all pixels
      for (let i = 0; i < totalPixels; i++) {
        const value = maskRaster[i];

        // Update statistics
        if (value > threshold) {
          buildingPixels++;
        }

        maxValue = Math.max(maxValue, value);
        minValue = Math.min(minValue, value);
        sum += value;
      }

      // Calculate additional statistics
      const avgValue = sum / totalPixels;
      const buildingPercentage = (buildingPixels / totalPixels) * 100;

      return {
        totalPixels,
        buildingPixels,
        nonBuildingPixels: totalPixels - buildingPixels,
        buildingPercentage,
        minValue,
        maxValue,
        avgValue,
      };
    } catch (error) {
      console.error(
        `[MaskProcessor] Error calculating mask statistics: ${error.message}`
      );

      // Return minimal statistics
      return {
        totalPixels: maskRaster.length,
        buildingPixels: 0,
        nonBuildingPixels: maskRaster.length,
        buildingPercentage: 0,
        error: error.message,
      };
    }
  }
}

module.exports = MaskProcessor;
