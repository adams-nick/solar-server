/**
 * Roof segment processor for SolarScanner data-layers module
 *
 * Processes buildingInsights data to extract and enhance roof segment information
 * for visualization and interaction, filtering segments smaller than 1.8 meters
 * and grouping similar segments that border or overlap each other.
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
   * @param {number} [options.minSegmentDimension=1.5] - Minimum segment dimension in meters (width or length)
   * @param {number} [options.minSegmentArea=11] - Minimum segment area in square meters
   * @param {boolean} [options.groupSimilarSegments=true] - Whether to group similar segments together
   * @param {number} [options.maxAzimuthDiff=5] - Maximum azimuth difference for grouping (in degrees)
   * @param {number} [options.maxPitchDiff=12] - Maximum pitch difference for grouping (in degrees)
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
        const minSegmentDimension = options.minSegmentDimension || 1.5; // Default to 1.5 meter minimum dimension
        const minSegmentArea = options.minSegmentArea || 11; // Default to 5 square meters minimum area
        const groupSimilarSegments = options.groupSimilarSegments !== false;
        const maxAzimuthDiff = options.maxAzimuthDiff || 5; // Default to 5 degrees
        const maxPitchDiff = options.maxPitchDiff || 12; // Default to 12 degrees

        // Extract roof segments
        const { roofSegmentStats } = buildingInsights.solarPotential;
        const maxSunshineHoursPerYear =
          buildingInsights.solarPotential.maxSunshineHoursPerYear;

        // Track statistics
        let filteredSegmentCount = 0;
        let filteredGroupCount = 0;
        const originalSegmentCount = roofSegmentStats.length;

        // First, process each individual segment (without filtering yet)
        const initialProcessedSegments = roofSegmentStats.map(
          (segment, index) => {
            // Calculate dimensions for later filtering
            const dimensions = this.calculateBoundingBoxDimensions(segment);

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

            // Generate orientation label
            const orientationLabel = this.getOrientationLabel(
              segment.azimuthDegrees,
              segment.pitchDegrees
            );

            // Create corners from boundingBox for visualization
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
              originalId: index, // Keep track of original ID
              pitch: segment.pitchDegrees,
              azimuth: segment.azimuthDegrees,
              area: segment.stats.areaMeters2,
              groundArea: segment.stats.groundAreaMeters2,
              center: segment.center,
              boundingBox: segment.boundingBox,
              corners: corners, // Include the inferred corners
              height: segment.planeHeightAtCenterMeters,
              suitability: suitabilityScore,
              dimensions: dimensions,
              orientation: orientationLabel,
              isHorizontal: segment.pitchDegrees <= 5,
              // Add fields for grouping
              grouped: false,
              groupId: null,
              isGrouped: false, // Flag for segments that will be included in groups
              originalSegment: segment, // Store the original API segment
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
          }
        );

        // Group similar segments BEFORE filtering by size
        let segmentsWithGroups = initialProcessedSegments;
        let groupCount = 0;
        let segmentsInGroups = 0;
        let groups = [];

        if (groupSimilarSegments && initialProcessedSegments.length > 1) {
          console.log("[RoofSegmentProcessor] Grouping similar segments");

          // Create a copy of the segments for grouping
          const segmentsForGrouping = initialProcessedSegments.map((s) => ({
            ...s,
          }));

          // Find segments to group
          const groupingResult = this.groupSimilarSegments(
            segmentsForGrouping,
            maxAzimuthDiff,
            maxPitchDiff
          );

          // Only use the grouping if it created some groups
          if (groupingResult.groups.length > 0) {
            segmentsWithGroups = groupingResult.groupedSegments;
            groups = groupingResult.groups;
            groupCount = groups.length;

            // Count how many segments are in groups
            segmentsInGroups = segmentsForGrouping.filter(
              (s) => s.isGrouped
            ).length;

            console.log(
              `[RoofSegmentProcessor] Created ${groupCount} groups from ${segmentsInGroups} segments`
            );
          } else {
            console.log(
              "[RoofSegmentProcessor] No effective grouping possible, using original segments"
            );
          }
        }

        // NOW apply size filtering to both individual segments and grouped segments
        const finalSegments = segmentsWithGroups.filter((segment) => {
          // Check if this is a grouped segment
          if (segment.isGroup) {
            // For grouped segments, check the combined dimensions
            if (
              segment.dimensions.minDimension < minSegmentDimension ||
              segment.area < minSegmentArea
            ) {
              console.log(
                `[RoofSegmentProcessor] Filtering out grouped segment ${
                  segment.id
                } with dimensions ${segment.dimensions.minDimension.toFixed(
                  2
                )}m and area ${segment.area.toFixed(2)}m²`
              );
              filteredGroupCount++;
              // Calculate how many segments this represents
              const groupMemberCount = segment.memberCount || 0;
              filteredSegmentCount += groupMemberCount;
              return false;
            }
            return true;
          } else {
            // For individual segments, check dimensions and area
            if (
              segment.dimensions.minDimension < minSegmentDimension ||
              segment.area < minSegmentArea
            ) {
              console.log(
                `[RoofSegmentProcessor] Filtering out segment ${
                  segment.id
                } with dimensions ${segment.dimensions.minDimension.toFixed(
                  2
                )}m and area ${segment.area.toFixed(2)}m²`
              );
              filteredSegmentCount++;
              return false;
            }
            return true;
          }
        });

        // Calculate overall bounds for the building
        const bounds = this.calculateBuildingBounds(finalSegments);

        // Create the result object
        const result = {
          layerType: "roofSegments",
          metadata: {
            buildingId: buildingInsights.name,
            imageryQuality: buildingInsights.imageryQuality,
            imageryDate: buildingInsights.imageryDate,
            segmentCount: finalSegments.length,
            originalSegmentCount,
            filteredSegmentCount,
            filteredGroupCount,
            groupCount,
            segmentsInGroups,
            minSegmentDimension,
            minSegmentArea,
            maxAzimuthDiff,
            maxPitchDiff,
            totalRoofArea:
              buildingInsights.solarPotential.wholeRoofStats.areaMeters2,
            maxSunshineHoursPerYear,
          },
          roofSegments: finalSegments,
          center: buildingInsights.center,
          bounds: bounds,
        };

        console.log(
          `[RoofSegmentProcessor] Processed ${finalSegments.length} roof segments ` +
            `(filtered out ${filteredSegmentCount} segments, ${filteredGroupCount} groups)`
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
   * Group similar segments that border or overlap each other
   * @private
   * @param {Array} segments - Array of processed segments
   * @param {number} maxAzimuthDiff - Maximum azimuth difference for grouping (in degrees)
   * @param {number} maxPitchDiff - Maximum pitch difference for grouping (in degrees)
   * @returns {Object} - Object containing grouped segments and group information
   */
  groupSimilarSegments(segments, maxAzimuthDiff, maxPitchDiff) {
    // Initialize all segments as ungrouped
    segments.forEach((segment) => {
      segment.grouped = false;
      segment.groupId = null;
      segment.isGrouped = false;
    });

    // Array to store our groups
    const groups = [];
    let nextGroupId = 0;

    // Function to check if two segments have similar orientation and pitch
    const areSimilar = (seg1, seg2) => {
      // Calculate azimuth difference (consider the circular nature of degrees)
      let azimuthDiff = Math.abs(seg1.azimuth - seg2.azimuth);
      if (azimuthDiff > 180) azimuthDiff = 360 - azimuthDiff;

      // Calculate pitch difference
      const pitchDiff = Math.abs(seg1.pitch - seg2.pitch);

      return azimuthDiff <= maxAzimuthDiff && pitchDiff <= maxPitchDiff;
    };

    // Function to check if two segments touch or overlap
    const areAdjacent = (seg1, seg2) => {
      // Get bounding boxes
      const box1 = {
        minLat: Math.min(
          seg1.boundingBox.sw.latitude,
          seg1.boundingBox.ne.latitude
        ),
        maxLat: Math.max(
          seg1.boundingBox.sw.latitude,
          seg1.boundingBox.ne.latitude
        ),
        minLng: Math.min(
          seg1.boundingBox.sw.longitude,
          seg1.boundingBox.ne.longitude
        ),
        maxLng: Math.max(
          seg1.boundingBox.sw.longitude,
          seg1.boundingBox.ne.longitude
        ),
      };

      const box2 = {
        minLat: Math.min(
          seg2.boundingBox.sw.latitude,
          seg2.boundingBox.ne.latitude
        ),
        maxLat: Math.max(
          seg2.boundingBox.sw.latitude,
          seg2.boundingBox.ne.latitude
        ),
        minLng: Math.min(
          seg2.boundingBox.sw.longitude,
          seg2.boundingBox.ne.longitude
        ),
        maxLng: Math.max(
          seg2.boundingBox.sw.longitude,
          seg2.boundingBox.ne.longitude
        ),
      };

      // Check for overlap or adjacency (with a small tolerance for floating-point comparison)
      const tolerance = 0.0000001; // Small tolerance for adjacency

      // Check if boxes overlap or touch
      const overlapX =
        box1.minLng - tolerance <= box2.maxLng &&
        box2.minLng - tolerance <= box1.maxLng;
      const overlapY =
        box1.minLat - tolerance <= box2.maxLat &&
        box2.minLat - tolerance <= box1.maxLat;

      return overlapX && overlapY;
    };

    // Recursive function to find all segments in a group
    const findGroupMembers = (segmentIndex, groupId, groupMembers = []) => {
      const segment = segments[segmentIndex];

      // Skip if already processed
      if (segment.grouped) return groupMembers;

      // Mark as grouped
      segment.grouped = true;
      segment.groupId = groupId;
      segment.isGrouped = true;

      // Add to group members
      groupMembers.push(segmentIndex);

      // Look for other ungrouped segments that are similar and adjacent
      for (let i = 0; i < segments.length; i++) {
        if (i !== segmentIndex && !segments[i].grouped) {
          // Check if similar and adjacent
          if (
            areSimilar(segment, segments[i]) &&
            areAdjacent(segment, segments[i])
          ) {
            // Recursively add this segment and its neighbors
            findGroupMembers(i, groupId, groupMembers);
          }
        }
      }

      return groupMembers;
    };

    // Iterate through segments to find groups
    for (let i = 0; i < segments.length; i++) {
      if (!segments[i].grouped) {
        // Start a new group with this segment
        const groupMembers = findGroupMembers(i, nextGroupId);

        // Only create a group if more than 1 segment
        if (groupMembers.length > 1) {
          groups.push({
            id: nextGroupId,
            memberIndices: groupMembers,
            members: groupMembers.map((idx) => segments[idx]),
          });
          nextGroupId++;
        } else {
          // Reset segment as ungrouped if it's alone in its group
          segments[i].grouped = false;
          segments[i].groupId = null;
          segments[i].isGrouped = false;
        }
      }
    }

    // Create combined segments for each group
    const combinedSegments = [];

    // Add segments that weren't grouped
    segments.forEach((segment) => {
      if (!segment.isGrouped) {
        combinedSegments.push(segment);
      }
    });

    // Create a combined segment for each group
    groups.forEach((group) => {
      const combinedSegment = this.createCombinedSegment(
        group.members,
        group.id
      );
      combinedSegments.push(combinedSegment);
    });

    return {
      groupedSegments: combinedSegments,
      groups,
    };
  }

  /**
   * Create a combined segment from multiple segments
   * @private
   * @param {Array} segments - Array of segments to combine
   * @param {number} groupId - Group ID
   * @returns {Object} - Combined segment with composite shape
   */
  createCombinedSegment(segments, groupId) {
    // Calculate area-weighted average for properties
    let totalArea = 0;
    let weightedPitchSum = 0;
    let weightedAzimuthSinSum = 0;
    let weightedAzimuthCosSum = 0;
    let suitabilitySum = 0;

    // Gather all individual segment IDs
    const segmentIds = segments.map((s) => s.id);

    // Find center point of all segments combined
    let centerLatSum = 0;
    let centerLngSum = 0;

    // Calculate weighted sums
    segments.forEach((segment) => {
      const weight = segment.area;
      totalArea += weight;

      weightedPitchSum += segment.pitch * weight;

      // Use trigonometry to handle the circular nature of azimuth
      // Convert azimuth to radians
      const azimuthRad = (segment.azimuth * Math.PI) / 180;
      weightedAzimuthSinSum += Math.sin(azimuthRad) * weight;
      weightedAzimuthCosSum += Math.cos(azimuthRad) * weight;

      suitabilitySum += segment.suitability * weight;

      // Sum center points for averaging
      centerLatSum += segment.center.latitude;
      centerLngSum += segment.center.longitude;
    });

    // Calculate weighted averages
    const avgPitch = weightedPitchSum / totalArea;

    // Calculate average azimuth using atan2 to handle circular values properly
    const avgAzimuthRad = Math.atan2(
      weightedAzimuthSinSum,
      weightedAzimuthCosSum
    );
    // Convert back to degrees and normalize to 0-360 range
    const avgAzimuth = ((((avgAzimuthRad * 180) / Math.PI) % 360) + 360) % 360;

    const avgSuitability = suitabilitySum / totalArea;

    // Average center point
    const avgCenter = {
      latitude: centerLatSum / segments.length,
      longitude: centerLngSum / segments.length,
    };

    // Create a composite shape by collecting all corners from all segments
    // We'll collect all corners and then remove duplicates and overlapping points
    let allCorners = [];

    // Collect all corners from all segments
    segments.forEach((segment) => {
      if (segment.corners && segment.corners.length > 0) {
        allCorners = allCorners.concat(segment.corners);
      }
    });

    // Remove duplicate or very close points
    // This is a simplified approach - a more complex algorithm would be needed
    // for a perfect polygon simplification
    const uniqueCorners = this.removeDuplicatePoints(allCorners);

    // Calculate the overall bounding box for dimensions calculation
    let minLat = 90,
      maxLat = -90,
      minLng = 180,
      maxLng = -180;
    uniqueCorners.forEach((corner) => {
      minLat = Math.min(minLat, corner.latitude);
      maxLat = Math.max(maxLat, corner.latitude);
      minLng = Math.min(minLng, corner.longitude);
      maxLng = Math.max(maxLng, corner.longitude);
    });

    // Calculate dimensions based on the overall extent
    const dimensions = this.calculateBoundingBoxDimensionsFromCorners(
      minLat,
      maxLat,
      minLng,
      maxLng
    );

    // Generate orientation label
    const orientationLabel = this.getOrientationLabel(avgAzimuth, avgPitch);

    // Create the combined segment
    const combinedSegment = {
      id: `group_${groupId}`,
      groupId: groupId,
      isGroup: true,
      memberIds: segmentIds,
      memberCount: segments.length,
      pitch: avgPitch,
      azimuth: avgAzimuth,
      area: totalArea,
      center: avgCenter,
      // Store all segment bounding boxes to create a composite shape
      componentSegments: segments.map((s) => ({
        boundingBox: s.boundingBox,
        corners: s.corners,
      })),
      // Include overall bounds for reference
      boundingBox: {
        sw: { latitude: minLat, longitude: minLng },
        ne: { latitude: maxLat, longitude: maxLng },
      },
      corners: uniqueCorners, // Use the composite shape corners
      suitability: avgSuitability,
      dimensions: dimensions,
      orientation: orientationLabel,
      isHorizontal: avgPitch <= 5,
      isPerimeter: true, // Flag that this is a perimeter-only representation
      isCompositeShape: true, // Flag that this is a composite shape
    };

    return combinedSegment;
  }

  /**
   * Remove duplicate or very close points from an array of coordinates
   * @private
   * @param {Array} points - Array of geographic coordinates
   * @returns {Array} - Array with duplicates removed
   */
  removeDuplicatePoints(points) {
    if (!points || points.length < 2) return points;

    // Tolerance for considering points as duplicates (in degrees)
    const tolerance = 0.0000001;

    const uniquePoints = [];

    // Check each point against all already-added unique points
    // This is an O(n²) algorithm but should be fine for our small number of points
    points.forEach((point) => {
      let isDuplicate = false;

      for (const uniquePoint of uniquePoints) {
        // Check if this point is very close to an existing point
        if (
          Math.abs(point.latitude - uniquePoint.latitude) < tolerance &&
          Math.abs(point.longitude - uniquePoint.longitude) < tolerance
        ) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        uniquePoints.push(point);
      }
    });

    return uniquePoints;
  }

  /**
   * Calculate bounding box dimensions from min/max coordinates
   * @private
   * @param {number} minLat - Minimum latitude
   * @param {number} maxLat - Maximum latitude
   * @param {number} minLng - Minimum longitude
   * @param {number} maxLng - Maximum longitude
   * @returns {Object} - Dimensions {width, length, minDimension} in meters
   */
  calculateBoundingBoxDimensionsFromCorners(minLat, maxLat, minLng, maxLng) {
    try {
      // Earth's radius in meters
      const earthRadius = 6371000;

      // Convert to radians
      const lat1 = (minLat * Math.PI) / 180;
      const lon1 = (minLng * Math.PI) / 180;
      const lat2 = (maxLat * Math.PI) / 180;
      const lon2 = (maxLng * Math.PI) / 180;

      // Width (East-West) - uses the average latitude to account for latitude distortion
      const avgLat = (lat1 + lat2) / 2;
      const width = earthRadius * Math.cos(avgLat) * Math.abs(lon2 - lon1);

      // Length (North-South)
      const length = earthRadius * Math.abs(lat2 - lat1);

      // Minimum dimension
      const minDimension = Math.min(width, length);

      return { width, length, minDimension };
    } catch (error) {
      console.error(
        `[RoofSegmentProcessor] Error calculating dimensions: ${error.message}`
      );
      // Return default values
      return { width: 0, length: 0, minDimension: 0 };
    }
  }

  /**
   * Calculate the dimensions of a segment's bounding box
   * @private
   * @param {Object} segment - Roof segment data from the Google Solar API
   * @returns {Object} - Dimensions {width, length, minDimension} in meters
   */
  calculateBoundingBoxDimensions(segment) {
    try {
      // Check if we have both needed corners
      if (
        !segment.boundingBox ||
        !segment.boundingBox.ne ||
        !segment.boundingBox.sw
      ) {
        return { width: 0, length: 0, minDimension: 0 };
      }

      const { ne, sw } = segment.boundingBox;

      // Calculate width and length in meters
      // Using the Haversine formula approximation for small distances

      // Earth's radius in meters
      const earthRadius = 6371000;

      // Convert to radians
      const lat1 = (sw.latitude * Math.PI) / 180;
      const lon1 = (sw.longitude * Math.PI) / 180;
      const lat2 = (ne.latitude * Math.PI) / 180;
      const lon2 = (ne.longitude * Math.PI) / 180;

      // Width (East-West) - uses the average latitude to account for latitude distortion
      const avgLat = (lat1 + lat2) / 2;
      const width = earthRadius * Math.cos(avgLat) * Math.abs(lon2 - lon1);

      // Length (North-South)
      const length = earthRadius * Math.abs(lat2 - lat1);

      // Minimum dimension
      const minDimension = Math.min(width, length);

      return { width, length, minDimension };
    } catch (error) {
      console.error(
        `[RoofSegmentProcessor] Error calculating bounding box dimensions: ${error.message}`
      );
      // Return default values
      return { width: 0, length: 0, minDimension: 0 };
    }
  }

  /**
   * Generate a descriptive orientation label based on azimuth angle
   * @private
   * @param {number} azimuth - Azimuth angle in degrees (0-360)
   * @param {number} pitch - Pitch angle in degrees
   * @returns {string} - Orientation label (e.g., "South", "Northwest", etc.)
   */
  getOrientationLabel(azimuth, pitch) {
    // If pitch is 5 degrees or less, it's considered horizontal
    if (pitch <= 5) {
      return "Horizontal";
    }

    // Normalize azimuth to 0-360 range
    const normalizedAzimuth = ((azimuth % 360) + 360) % 360;

    // Define azimuth ranges for cardinal and intercardinal directions
    const directions = [
      { label: "North", min: 337.5, max: 22.5 },
      { label: "Northeast", min: 22.5, max: 67.5 },
      { label: "East", min: 67.5, max: 112.5 },
      { label: "Southeast", min: 112.5, max: 157.5 },
      { label: "South", min: 157.5, max: 202.5 },
      { label: "Southwest", min: 202.5, max: 247.5 },
      { label: "West", min: 247.5, max: 292.5 },
      { label: "Northwest", min: 292.5, max: 337.5 },
    ];

    // Find matching direction
    let directionLabel = "Unknown";

    for (const direction of directions) {
      if (
        (direction.min <= normalizedAzimuth &&
          normalizedAzimuth < direction.max) ||
        (direction.min > direction.max &&
          (normalizedAzimuth >= direction.min ||
            normalizedAzimuth < direction.max))
      ) {
        directionLabel = direction.label;
        break;
      }
    }

    // Add precise degree information
    const degreeInfo = this.formatAzimuthDegrees(normalizedAzimuth);

    return `${directionLabel} (${degreeInfo})`;
  }

  /**
   * Format azimuth angle into a readable degree format
   * @private
   * @param {number} azimuth - Azimuth angle in degrees
   * @returns {string} - Formatted degree string
   */
  formatAzimuthDegrees(azimuth) {
    // Convert azimuth to relative degree from North
    let relativeAngle;

    if (azimuth <= 180) {
      // East of North
      relativeAngle = azimuth;
      return `${Math.round(relativeAngle)}° E of N`;
    } else {
      // West of North
      relativeAngle = 360 - azimuth;
      return `${Math.round(relativeAngle)}° W of N`;
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
      // Check all corner points
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

      // Also check boundingBox as a fallback
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

      // Also check center point
      if (segment.center) {
        north = Math.max(north, segment.center.latitude);
        south = Math.min(south, segment.center.latitude);
        east = Math.max(east, segment.center.longitude);
        west = Math.min(west, segment.center.longitude);
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
