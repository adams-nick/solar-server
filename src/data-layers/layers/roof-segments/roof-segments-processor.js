/**
 * Roof segment processor for SolarScanner data-layers module
 *
 * Processes buildingInsights data to extract and enhance roof segment information
 * for visualization and interaction.
 */

const Processor = require("../../core/processor");

/**
 * Processor implementation for roof segment data
 * @extends Processor
 */
class RoofSegmentProcessor extends Processor {
  /**
   * Create a new RoofSegmentProcessor
   */
  constructor() {
    super();
    console.log("[RoofSegmentProcessor] Initialized");
  }

  /**
   * Check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "roofSegments";
  }

  /**
   * Process buildingInsights data to extract roof segments
   * @param {Object} buildingInsights - BuildingInsights data from Google Solar API
   * @param {Object} options - Processing options
   * @param {boolean} [options.calculateSuitability=true] - Whether to calculate suitability scores
   * @param {boolean} [options.includeSunshineData=true] - Whether to include detailed sunshine data
   * @returns {Promise<Object>} - Processed roof segment data
   * @throws {Error} if processing fails
   */
  async process(buildingInsights, options = {}) {
    try {
      return await this.timeOperation("process", async () => {
        console.log("[RoofSegmentProcessor] Processing roof segment data");

        // Validate that we have buildingInsights data
        if (
          !buildingInsights ||
          !buildingInsights.solarPotential ||
          !buildingInsights.solarPotential.roofSegmentStats
        ) {
          throw new Error(
            "Missing required buildingInsights data for roof segment processing"
          );
        }

        // Set default options
        const calculateSuitability = options.calculateSuitability !== false;
        const includeSunshineData = options.includeSunshineData !== false;

        // Extract roof segments
        const { roofSegmentStats } = buildingInsights.solarPotential;
        const maxSunshineHoursPerYear =
          buildingInsights.solarPotential.maxSunshineHoursPerYear;

        // Process each roof segment
        const processedSegments = roofSegmentStats.map((segment, index) => {
          // Calculate suitability score if requested
          let suitabilityScore = 0.5; // Default middle value

          if (calculateSuitability) {
            // Calculate azimuth factor (south-facing is best)
            // South = 180 degrees, higher score
            // North = 0 or 360 degrees, lower score
            const azimuthFactor = Math.cos(
              ((segment.azimuthDegrees - 180) * Math.PI) / 180
            );

            // Normalize between 0 and 1 (1 = best, 0 = worst)
            const azimuthScore = (azimuthFactor + 1) / 2;

            // Calculate sunshine score based on median sunshine hours
            const sunshineMedian = segment.stats.sunshineQuantiles[5]; // median is at index 5
            const sunshineScore =
              maxSunshineHoursPerYear > 0
                ? sunshineMedian / maxSunshineHoursPerYear
                : 0.5;

            // Incorporate pitch factor (moderate pitch is best)
            // Optimal pitch is typically close to the latitude (approx ~30-40 degrees)
            const optimalPitch = 35; // Simplified assumption for optimal pitch
            const pitchFactor =
              1 -
              Math.min(1, Math.abs(segment.pitchDegrees - optimalPitch) / 45);

            // Combine factors (weight sunshine more heavily than orientation)
            suitabilityScore =
              sunshineScore * 0.6 + azimuthScore * 0.3 + pitchFactor * 0.1;
          }

          // Derive corners from boundingBox for visualization
          // Note: This is a simplified approach - for more accurate polygon shapes,
          // you would need more detailed geometry that Google Solar API doesn't provide
          const corners = [
            segment.boundingBox.sw, // Southwest corner
            {
              // Southeast corner
              latitude: segment.boundingBox.sw.latitude,
              longitude: segment.boundingBox.ne.longitude,
            },
            segment.boundingBox.ne, // Northeast corner
            {
              // Northwest corner
              latitude: segment.boundingBox.ne.latitude,
              longitude: segment.boundingBox.sw.longitude,
            },
          ];

          // Create the processed segment object
          const processedSegment = {
            id: index,
            pitch: segment.pitchDegrees,
            azimuth: segment.azimuthDegrees,
            area: segment.stats.areaMeters2,
            groundArea: segment.stats.groundAreaMeters2,
            center: segment.center,
            corners: corners,
            boundingBox: segment.boundingBox,
            height: segment.planeHeightAtCenterMeters,
            suitability: suitabilityScore,
          };

          // Add sunshine data if requested
          if (includeSunshineData) {
            processedSegment.sunshineHours = {
              min: segment.stats.sunshineQuantiles[0],
              q1: segment.stats.sunshineQuantiles[2],
              median: segment.stats.sunshineQuantiles[5],
              q3: segment.stats.sunshineQuantiles[8],
              max: segment.stats.sunshineQuantiles[10],
              allQuantiles: segment.stats.sunshineQuantiles,
            };
          }

          return processedSegment;
        });

        // Calculate overall bounds for the building
        const bounds = this.calculateBuildingBounds(processedSegments);

        // Create the result object
        const result = {
          layerType: "roofSegments",
          metadata: {
            buildingId: buildingInsights.name,
            imageryQuality: buildingInsights.imageryQuality,
            imageryDate: buildingInsights.imageryDate,
            segmentCount: processedSegments.length,
            totalRoofArea:
              buildingInsights.solarPotential.wholeRoofStats.areaMeters2,
            maxSunshineHoursPerYear,
          },
          roofSegments: processedSegments,
          center: buildingInsights.center,
          bounds: bounds,
        };

        console.log(
          `[RoofSegmentProcessor] Processed ${processedSegments.length} roof segments`
        );

        return result;
      });
    } catch (error) {
      return this.handleProcessingError(error, "process", {
        layerType: "roofSegments",
        options,
      });
    }
  }

  /**
   * Calculate the overall geographic bounds of the building
   * @private
   * @param {Array} segments - Array of processed roof segments
   * @returns {Object} - Geographic bounds {north, south, east, west}
   */
  calculateBuildingBounds(segments) {
    let north = -90,
      south = 90,
      east = -180,
      west = 180;

    segments.forEach((segment) => {
      // Check boundingBox
      const box = segment.boundingBox;
      if (box) {
        if (box.ne) {
          north = Math.max(north, box.ne.latitude);
          east = Math.max(east, box.ne.longitude);
        }
        if (box.sw) {
          south = Math.min(south, box.sw.latitude);
          west = Math.min(west, box.sw.longitude);
        }
      }

      // Also check corners if available
      if (segment.corners) {
        segment.corners.forEach((corner) => {
          if (corner) {
            north = Math.max(north, corner.latitude);
            south = Math.min(south, corner.latitude);
            east = Math.max(east, corner.longitude);
            west = Math.min(west, corner.longitude);
          }
        });
      }
    });

    // Add a small buffer around the bounds (5%)
    const latBuffer = (north - south) * 0.05;
    const lngBuffer = (east - west) * 0.05;

    return {
      north: north + latBuffer,
      south: south - latBuffer,
      east: east + lngBuffer,
      west: west - lngBuffer,
    };
  }
}

module.exports = RoofSegmentProcessor;
