/**
 * Solar Panel Analysis Module
 *
 * Provides functions for analyzing roof data and generating optimal
 * solar panel layouts while detecting obstructions.
 */

// Define standard solar panel dimensions in meters as constants
const STANDARD_PANEL_WIDTH = 1.045; // meters
const STANDARD_PANEL_HEIGHT = 1.879; // meters
const PANEL_SPACING = 0; // meters - spacing between panels

/**
 * Generate optimal panel layout based on roof segments and obstructions
 * @param {Array} roofSegments - Roof segments from ML server
 * @param {Array} obstructions - Obstructions identified in the segments
 * @param {Object} dimensions - Real-world dimensions
 * @param {Object} dsmData - DSM data for elevation/slope checks (optional)
 * @returns {Object} - Optimized panel layout with obstructions preserved
 */
function generateOptimalPanelLayout(
  roofSegments,
  obstructions = [],
  dimensions,
  dsmData = null
) {
  try {
    console.log("Generating optimal solar panel layout");

    // Log the actual obstructions we're working with
    console.log(
      `Working with ${
        obstructions?.length || 0
      } existing obstructions for panel layout`
    );

    // Arrays to store results
    const panelLayout = [];
    const detectedObstructions = [...(obstructions || [])]; // Start with existing obstructions

    // Process each roof segment
    for (let i = 0; i < roofSegments.length; i++) {
      const segment = roofSegments[i];

      // Skip segments without valid polygons
      if (!segment.polygon || segment.polygon.length < 3) {
        console.log(`Skipping segment ${segment.id} - no valid polygon`);
        continue;
      }

      // Get segment metadata - both azimuth and orientation are used if available
      const pitch = segment.pitch || 20; // Default 20 degree pitch if not specified
      const azimuth = segment.azimuth || 180; // Default south-facing
      const orientation =
        segment.orientation || getOrientationFromAzimuth(azimuth);

      console.log(
        `Processing segment ${segment.id} - Pitch: ${pitch}°, Azimuth: ${azimuth}°, Orientation: ${orientation}`
      );

      // Filter obstructions for this segment
      const segmentObstructions = detectedObstructions.filter(
        (o) => o.segmentId === segment.id
      );
      console.log(
        `Found ${segmentObstructions.length} obstructions for segment ${segment.id}`
      );

      // Get polygon bounding box
      const bounds = getPolygonBounds(segment.polygon);

      // Constrain bounds to image dimensions
      const constrainedBounds = {
        minX: Math.max(0, bounds.minX),
        minY: Math.max(0, bounds.minY),
        maxX: Math.min(dimensions.pixelWidth - 1, bounds.maxX),
        maxY: Math.min(dimensions.pixelHeight - 1, bounds.maxY),
      };

      // Determine layout orientation based on orientation property or azimuth
      const layoutDirection = determineLayoutDirection(orientation, azimuth);
      console.log(
        `Determined layout direction: ${layoutDirection.direction} (${layoutDirection.description})`
      );

      // *** NEW APPROACH: Test different layout configurations and select the best one ***
      const layoutOptions = [];

      // Test portrait orientation with different grid strategies
      const portraitResults = testMultipleLayoutStrategies(
        segment,
        segmentObstructions,
        constrainedBounds,
        dimensions,
        dsmData,
        pitch,
        azimuth,
        false // portrait (not landscape)
      );
      layoutOptions.push(...portraitResults);

      // Test landscape orientation with different grid strategies
      const landscapeResults = testMultipleLayoutStrategies(
        segment,
        segmentObstructions,
        constrainedBounds,
        dimensions,
        dsmData,
        pitch,
        azimuth,
        true // landscape
      );
      layoutOptions.push(...landscapeResults);

      // Find the best layout (maximum number of panels)
      const bestLayout = layoutOptions.reduce(
        (best, current) =>
          current.panels.length > best.panels.length ? current : best,
        { panels: [], obstructions: [] }
      );

      // Log results of optimization
      console.log(`Selected best layout for segment ${segment.id}:`);
      console.log(`- Panel count: ${bestLayout.panels.length}`);
      console.log(`- Orientation: ${bestLayout.orientation}`);
      console.log(`- Layout strategy: ${bestLayout.strategy}`);
      console.log(`- Start point: ${bestLayout.startPoint}`);

      // Add the best layout panels and obstructions to the overall results
      panelLayout.push(...bestLayout.panels);
      detectedObstructions.push(...bestLayout.obstructions);
    }

    // Calculate overall statistics
    const totalArea = panelLayout.reduce(
      (sum, panel) => sum + panel.realWidth * panel.realHeight,
      0
    );

    const avgEfficiency = 0.2; // 20% panel efficiency
    const avgIrradiance = 1000; // W/m² (standard test condition)
    const totalPotentialKw = (totalArea * avgEfficiency * avgIrradiance) / 1000;

    console.log(`Total panel layout generated: ${panelLayout.length} panels`);
    console.log(`Total obstructions detected: ${detectedObstructions.length}`);

    return {
      panelLayout,
      obstructions: detectedObstructions,
      metadata: {
        panelCount: panelLayout.length,
        totalArea: totalArea.toFixed(2),
        potentialKw: totalPotentialKw.toFixed(2),
        standardDimensions: {
          width: STANDARD_PANEL_WIDTH,
          height: STANDARD_PANEL_HEIGHT,
          spacing: PANEL_SPACING,
        },
      },
    };
  } catch (error) {
    console.error(`Error generating optimal panel layout: ${error.message}`);
    return {
      panelLayout: [],
      obstructions: obstructions || [], // Return any existing obstructions
      metadata: {
        error: error.message,
      },
    };
  }
}

/**
 * Test multiple layout strategies and return the results for each
 * @param {Object} segment - Roof segment
 * @param {Array} obstructions - Segment obstructions
 * @param {Object} bounds - Constrained bounds
 * @param {Object} dimensions - Real-world dimensions
 * @param {Object} dsmData - DSM data
 * @param {number} pitch - Roof pitch
 * @param {number} azimuth - Roof azimuth
 * @param {boolean} isLandscape - Whether to use landscape orientation
 * @returns {Array} Array of layout results
 */
function testMultipleLayoutStrategies(
  segment,
  obstructions,
  bounds,
  dimensions,
  dsmData,
  pitch,
  azimuth,
  isLandscape
) {
  const results = [];
  const orientationName = isLandscape ? "landscape" : "portrait";

  // Adjust panel dimensions based on orientation and pitch
  const pitchRadians = (pitch * Math.PI) / 180;
  const cosineSlope = Math.cos(pitchRadians);

  // Set panel dimensions based on orientation
  let adjustedWidth, adjustedHeight;
  if (isLandscape) {
    // Swap dimensions for landscape orientation
    adjustedWidth = STANDARD_PANEL_HEIGHT;
    adjustedHeight = STANDARD_PANEL_WIDTH;
  } else {
    adjustedWidth = STANDARD_PANEL_WIDTH;
    adjustedHeight = STANDARD_PANEL_HEIGHT;
  }

  // Determine which dimension to adjust based on layout direction
  const layoutDirection = determineLayoutDirection(
    segment.orientation,
    azimuth
  );

  let panelWidthPx, panelHeightPx;
  if (layoutDirection.direction === "horizontal") {
    // For horizontal layouts (north/south facing), height is along the slope
    panelWidthPx = Math.round(adjustedWidth / dimensions.metersPerPixelX);
    panelHeightPx = Math.round(
      (adjustedHeight * cosineSlope) / dimensions.metersPerPixelY
    );
  } else {
    // For vertical layouts (east/west facing), width is along the slope
    panelWidthPx = Math.round(
      (adjustedWidth * cosineSlope) / dimensions.metersPerPixelX
    );
    panelHeightPx = Math.round(adjustedHeight / dimensions.metersPerPixelY);
  }

  // Add spacing (which is 0 in this case)
  const spacedWidth = panelWidthPx;
  const spacedHeight = panelHeightPx;

  // Test different starting points for grid layout
  const startingPoints = [
    { name: "topLeft", x: bounds.minX, y: bounds.minY },
    { name: "topRight", x: bounds.maxX, y: bounds.minY },
    { name: "bottomLeft", x: bounds.minX, y: bounds.maxY },
    { name: "bottomRight", x: bounds.maxX, y: bounds.maxY },
    {
      name: "center",
      x: Math.floor((bounds.minX + bounds.maxX) / 2),
      y: Math.floor((bounds.minY + bounds.maxY) / 2),
    },
  ];

  // Test standard grid layout from each starting point
  for (const startPoint of startingPoints) {
    // Calculate grid parameters based on starting point
    const gridParams = calculateGridParametersFromPoint(
      bounds,
      startPoint,
      layoutDirection,
      azimuth
    );

    // Generate standard grid layout
    const standardGrid = generatePanelGrid(
      segment,
      obstructions,
      gridParams.startPoint,
      gridParams.rowIncrement,
      gridParams.colIncrement,
      spacedWidth,
      spacedHeight,
      bounds,
      dimensions,
      dsmData,
      pitch
    );

    results.push({
      panels: standardGrid.panels,
      obstructions: standardGrid.obstructions,
      orientation: orientationName,
      strategy: "standard",
      startPoint: startPoint.name,
    });

    // Generate staggered grid layout
    const staggeredGrid = generateStaggeredPanelGrid(
      segment,
      obstructions,
      gridParams.startPoint,
      gridParams.rowIncrement,
      gridParams.colIncrement,
      spacedWidth,
      spacedHeight,
      bounds,
      dimensions,
      dsmData,
      pitch
    );

    results.push({
      panels: staggeredGrid.panels,
      obstructions: staggeredGrid.obstructions,
      orientation: orientationName,
      strategy: "staggered",
      startPoint: startPoint.name,
    });
  }

  return results;
}

/**
 * Calculate grid parameters from specified starting point
 * @param {Object} bounds - Segment bounds
 * @param {Object} startPoint - Start point {x, y}
 * @param {Object} layoutDirection - Layout direction info
 * @param {number} azimuth - Roof azimuth
 * @returns {Object} Grid parameters
 */
function calculateGridParametersFromPoint(
  bounds,
  startPoint,
  layoutDirection,
  azimuth
) {
  let rowIncrement = { x: 0, y: 0 };
  let colIncrement = { x: 0, y: 0 };

  // Determine row and column increments based on the starting corner
  const isTop = startPoint.y === bounds.minY;
  const isLeft = startPoint.x === bounds.minX;
  const isCenter =
    startPoint.x !== bounds.minX &&
    startPoint.x !== bounds.maxX &&
    startPoint.y !== bounds.minY &&
    startPoint.y !== bounds.maxY;

  if (layoutDirection.direction === "horizontal") {
    // For horizontal layouts (north/south facing)
    rowIncrement.y = isTop ? 1 : -1;
    colIncrement.x = isLeft ? 1 : -1;

    if (isCenter) {
      // From center, go in both directions but we'll use these initial directions
      rowIncrement.y = 1;
      colIncrement.x = 1;
    }
  } else {
    // For vertical layouts (east/west facing)
    rowIncrement.y = isTop ? 1 : -1;
    colIncrement.x = isLeft ? 1 : -1;

    if (isCenter) {
      rowIncrement.y = 1;
      colIncrement.x = 1;
    }
  }

  // Return the calculated parameters
  return {
    startPoint: { x: startPoint.x, y: startPoint.y },
    rowIncrement,
    colIncrement,
  };
}

/**
 * Generate staggered panel grid for better coverage
 * @param {Object} segment - Roof segment
 * @param {Array} obstructions - Obstructions list
 * @param {Object} startPoint - Start point {x, y}
 * @param {Object} rowIncrement - Row increment {x, y}
 * @param {Object} colIncrement - Column increment {x, y}
 * @param {number} panelWidthPx - Panel width in pixels
 * @param {number} panelHeightPx - Panel height in pixels
 * @param {Object} bounds - Segment bounds
 * @param {Object} dimensions - Real-world dimensions
 * @param {Object} dsmData - DSM data
 * @param {number} pitch - Roof pitch
 * @returns {Object} Panels and obstructions
 */
function generateStaggeredPanelGrid(
  segment,
  obstructions,
  startPoint,
  rowIncrement,
  colIncrement,
  panelWidthPx,
  panelHeightPx,
  bounds,
  dimensions,
  dsmData = null,
  pitch = 20
) {
  const panels = [];
  const newObstructions = [];

  // Calculate bounds width and height
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  // Determine row and column steps based on panel dimensions
  const rowStep = rowIncrement.y !== 0 ? panelHeightPx : panelWidthPx;
  const colStep = colIncrement.x !== 0 ? panelWidthPx : panelHeightPx;

  // Determine max grid iterations
  const maxRows = Math.ceil(boundsHeight / rowStep) + 1;
  const maxCols = Math.ceil(boundsWidth / colStep) + 1;

  console.log(
    `Staggered grid parameters: ${maxRows} rows x ${maxCols} columns`
  );

  // Calculate baseline slope from pitch
  const baselineSlope = Math.tan((pitch * Math.PI) / 180);
  const MAX_SLOPE_DEVIATION = 15;

  // Track panel positions in rows and columns
  for (let row = 0; row < maxRows; row++) {
    // Calculate row offset for staggered pattern (half a panel width on alternating rows)
    const staggerOffset =
      row % 2 === 0 ? 0 : Math.floor(panelWidthPx / 2) * colIncrement.x;

    for (let col = 0; col < maxCols; col++) {
      // Calculate panel position with stagger offset
      const x = Math.round(
        startPoint.x +
          colIncrement.x * col * colStep +
          rowIncrement.x * row * rowStep +
          staggerOffset
      );
      const y = Math.round(
        startPoint.y +
          colIncrement.y * col * colStep +
          rowIncrement.y * row * rowStep
      );

      // Check if we're within image boundaries
      if (
        x < 0 ||
        y < 0 ||
        x + panelWidthPx > dimensions.pixelWidth ||
        y + panelHeightPx > dimensions.pixelHeight
      ) {
        continue;
      }

      // Create panel polygon
      const panelPolygon = rectangleToPolygon(
        x,
        y,
        panelWidthPx,
        panelHeightPx
      );

      // Check if panel position is valid (within segment and not overlapping obstructions)
      const validationResult = isPanelValid(
        panelPolygon,
        segment.polygon,
        obstructions
      );

      if (validationResult.isValid) {
        // If DSM data is available, validate slope consistency
        let isValidSlope = true;
        let slopeInfo = {};

        if (dsmData && dsmData.raster) {
          const slopeCheck = checkBlockSlope(
            dsmData.raster,
            x,
            y,
            panelWidthPx,
            panelHeightPx,
            dimensions,
            baselineSlope,
            MAX_SLOPE_DEVIATION
          );

          isValidSlope = slopeCheck.isValid;
          slopeInfo = {
            avgSlope: slopeCheck.avgSlope,
            localDeviation: slopeCheck.localDeviation,
            globalDeviation: slopeCheck.globalDeviation,
            type: slopeCheck.type,
          };

          if (!isValidSlope) {
            // Create obstruction due to slope inconsistency
            newObstructions.push({
              id: `slope_obstruction_${segment.id}_${newObstructions.length}`,
              segmentId: segment.id,
              x: x,
              y: y,
              width: panelWidthPx,
              height: panelHeightPx,
              type: slopeCheck.type || "slope_inconsistency",
              reason: "Slope inconsistency detected",
              polygon: panelPolygon,
              ...slopeInfo,
            });
            continue; // Skip this panel position
          }
        }

        // Create panel object with all metadata
        const panel = {
          id: `panel_${segment.id}_${panels.length}`,
          segmentId: segment.id,
          x: x,
          y: y,
          width: panelWidthPx,
          height: panelHeightPx,
          realWidth: panelWidthPx * dimensions.metersPerPixelX,
          realHeight: panelHeightPx * dimensions.metersPerPixelY,
          pitch: segment.pitch || pitch,
          azimuth: segment.azimuth,
          orientation: segment.orientation,
          row: row,
          col: col,
          polygon: panelPolygon,
          ...slopeInfo,
        };

        panels.push(panel);
      } else if (validationResult.reason === "obstruction_overlap") {
        // Panel position overlaps with an existing obstruction - no need to add a new one
        continue;
      } else {
        // Invalid panel position that's not due to an existing obstruction
        // Add as a new detected obstruction
        newObstructions.push({
          id: `boundary_obstruction_${segment.id}_${newObstructions.length}`,
          segmentId: segment.id,
          x: x,
          y: y,
          width: panelWidthPx,
          height: panelHeightPx,
          type: "segment_boundary",
          reason: validationResult.reason || "Outside segment boundary",
          polygon: panelPolygon,
        });
      }
    }
  }

  return { panels, obstructions: newObstructions };
}

/**
 * Get textual orientation from azimuth value
 * @param {number} azimuth - Azimuth in degrees
 * @returns {string} - Orientation description
 */
function getOrientationFromAzimuth(azimuth) {
  // Normalize azimuth to 0-360 range
  const normalizedAzimuth = ((azimuth % 360) + 360) % 360;

  // Convert to 8-point compass direction
  if (normalizedAzimuth >= 337.5 || normalizedAzimuth < 22.5) {
    return "north";
  } else if (normalizedAzimuth >= 22.5 && normalizedAzimuth < 67.5) {
    return "north-east";
  } else if (normalizedAzimuth >= 67.5 && normalizedAzimuth < 112.5) {
    return "east";
  } else if (normalizedAzimuth >= 112.5 && normalizedAzimuth < 157.5) {
    return "south-east";
  } else if (normalizedAzimuth >= 157.5 && normalizedAzimuth < 202.5) {
    return "south";
  } else if (normalizedAzimuth >= 202.5 && normalizedAzimuth < 247.5) {
    return "south-west";
  } else if (normalizedAzimuth >= 247.5 && normalizedAzimuth < 292.5) {
    return "west";
  } else {
    return "north-west";
  }
}

/**
 * Determine optimal panel layout direction based on orientation and azimuth
 * @param {string} orientation - Roof orientation (e.g., "south", "west")
 * @param {number} azimuth - Roof azimuth in degrees
 * @returns {Object} - Layout direction details
 */
function determineLayoutDirection(orientation, azimuth) {
  // First try to use the explicit orientation if available
  if (orientation) {
    // Convert orientation to lowercase for case-insensitive matching
    const direction = orientation.toLowerCase();

    // East/West facing roofs - use vertical layout (panels in north-south rows)
    if (direction.includes("east") || direction.includes("west")) {
      return {
        direction: "vertical",
        description: direction.includes("east") ? "East-facing" : "West-facing",
      };
    }
    // North/South facing roofs - use horizontal layout (panels in east-west rows)
    else if (direction.includes("north") || direction.includes("south")) {
      return {
        direction: "horizontal",
        description: direction.includes("south")
          ? "South-facing"
          : "North-facing",
      };
    }
  }

  // If no valid orientation string, fall back to azimuth
  // Normalize azimuth to 0-360 range
  const normalizedAzimuth = ((azimuth % 360) + 360) % 360;

  // East/West facing roofs (90° ± 45° or 270° ± 45°) - vertical layout
  if (
    (normalizedAzimuth >= 45 && normalizedAzimuth <= 135) ||
    (normalizedAzimuth >= 225 && normalizedAzimuth <= 315)
  ) {
    return {
      direction: "vertical",
      description: normalizedAzimuth < 180 ? "East-facing" : "West-facing",
    };
  }
  // North/South facing roofs - horizontal layout
  else {
    return {
      direction: "horizontal",
      description:
        normalizedAzimuth >= 135 && normalizedAzimuth <= 225
          ? "South-facing"
          : "North-facing",
    };
  }
}

/**
 * Generate panel grid within a roof segment
 * @param {Object} segment - Roof segment
 * @param {Array} obstructions - Obstructions in the segment
 * @param {Object} startPoint - Starting point for grid
 * @param {Object} rowIncrement - Row increment direction
 * @param {Object} colIncrement - Column increment direction
 * @param {number} panelWidthPx - Panel width in pixels
 * @param {number} panelHeightPx - Panel height in pixels
 * @param {Object} bounds - Segment bounds
 * @param {Object} dimensions - Real-world dimensions
 * @param {Object} dsmData - DSM data for elevation checks (optional)
 * @param {number} pitch - Roof pitch in degrees
 * @returns {Object} - Object containing panels and newly detected obstructions
 */
function generatePanelGrid(
  segment,
  obstructions,
  startPoint,
  rowIncrement,
  colIncrement,
  panelWidthPx,
  panelHeightPx,
  bounds,
  dimensions,
  dsmData = null,
  pitch = 20
) {
  const panels = [];
  const newObstructions = [];

  // Calculate bounds width and height
  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  // Determine row and column steps based on panel dimensions
  const rowStep = rowIncrement.y !== 0 ? panelHeightPx : panelWidthPx;
  const colStep = colIncrement.x !== 0 ? panelWidthPx : panelHeightPx;

  // Determine max grid iterations
  const maxRows = Math.ceil(boundsHeight / rowStep) + 1;
  const maxCols = Math.ceil(boundsWidth / colStep) + 1;

  console.log(`Grid parameters: ${maxRows} rows x ${maxCols} columns`);

  // Calculate baseline slope from pitch
  const baselineSlope = Math.tan((pitch * Math.PI) / 180);

  // Maximum slope deviation in degrees for validation
  const MAX_SLOPE_DEVIATION = 15;

  // Track panel positions in rows and columns
  for (let row = 0; row < maxRows; row++) {
    for (let col = 0; col < maxCols; col++) {
      // Calculate panel position
      const x = Math.round(
        startPoint.x +
          colIncrement.x * col * colStep +
          rowIncrement.x * row * rowStep
      );
      const y = Math.round(
        startPoint.y +
          colIncrement.y * col * colStep +
          rowIncrement.y * row * rowStep
      );

      // Check if we're within image boundaries
      if (
        x < 0 ||
        y < 0 ||
        x + panelWidthPx > dimensions.pixelWidth ||
        y + panelHeightPx > dimensions.pixelHeight
      ) {
        continue;
      }

      // Create panel polygon
      const panelPolygon = rectangleToPolygon(
        x,
        y,
        panelWidthPx,
        panelHeightPx
      );

      // Check if panel position is valid (within segment and not overlapping obstructions)
      const validationResult = isPanelValid(
        panelPolygon,
        segment.polygon,
        obstructions
      );

      if (validationResult.isValid) {
        // If DSM data is available, validate slope consistency
        let isValidSlope = true;
        let slopeInfo = {};

        if (dsmData && dsmData.raster) {
          const slopeCheck = checkBlockSlope(
            dsmData.raster,
            x,
            y,
            panelWidthPx,
            panelHeightPx,
            dimensions,
            baselineSlope,
            MAX_SLOPE_DEVIATION
          );

          isValidSlope = slopeCheck.isValid;
          slopeInfo = {
            avgSlope: slopeCheck.avgSlope,
            localDeviation: slopeCheck.localDeviation,
            globalDeviation: slopeCheck.globalDeviation,
            type: slopeCheck.type,
          };

          if (!isValidSlope) {
            // Create obstruction due to slope inconsistency
            newObstructions.push({
              id: `slope_obstruction_${segment.id}_${newObstructions.length}`,
              segmentId: segment.id,
              x: x,
              y: y,
              width: panelWidthPx,
              height: panelHeightPx,
              type: slopeCheck.type || "slope_inconsistency",
              reason: "Slope inconsistency detected",
              polygon: panelPolygon,
              ...slopeInfo,
            });
            continue; // Skip this panel position
          }
        }

        // Create panel object with all metadata
        const panel = {
          id: `panel_${segment.id}_${panels.length}`,
          segmentId: segment.id,
          x: x,
          y: y,
          width: panelWidthPx,
          height: panelHeightPx,
          realWidth: panelWidthPx * dimensions.metersPerPixelX,
          realHeight: panelHeightPx * dimensions.metersPerPixelY,
          pitch: segment.pitch || pitch,
          azimuth: segment.azimuth,
          orientation: segment.orientation,
          row: row,
          col: col,
          polygon: panelPolygon,
          ...slopeInfo,
        };

        panels.push(panel);
      } else if (validationResult.reason === "obstruction_overlap") {
        // Panel position overlaps with an existing obstruction - no need to add a new one
        continue;
      } else {
        // Invalid panel position that's not due to an existing obstruction
        // Add as a new detected obstruction
        newObstructions.push({
          id: `boundary_obstruction_${segment.id}_${newObstructions.length}`,
          segmentId: segment.id,
          x: x,
          y: y,
          width: panelWidthPx,
          height: panelHeightPx,
          type: "segment_boundary",
          reason: validationResult.reason || "Outside segment boundary",
          polygon: panelPolygon,
        });
      }
    }
  }

  return { panels, obstructions: newObstructions };
}

/**
 * Check if a panel is valid (within segment and not overlapping obstructions)
 * @param {Array} panelPolygon - Panel polygon
 * @param {Array} segmentPolygon - Segment polygon
 * @param {Array} obstructions - Obstructions array
 * @returns {Object} - Validation result with isValid flag and reason if invalid
 */
function isPanelValid(panelPolygon, segmentPolygon, obstructions) {
  // Check all four corners of the panel
  const corners = [
    panelPolygon[0], // top-left
    panelPolygon[1], // top-right
    panelPolygon[2], // bottom-right
    panelPolygon[3], // bottom-left
  ];

  // Panel is valid if all corners are inside segment
  const allCornersInSegment = corners.every((corner) =>
    isPointInPolygon(corner.x, corner.y, segmentPolygon)
  );

  if (!allCornersInSegment) {
    return { isValid: false, reason: "outside_segment" };
  }

  // Panel is invalid if it overlaps with any obstruction
  for (const obstruction of obstructions) {
    if (!obstruction.polygon) continue;

    // Check if any corner of the panel is inside the obstruction
    const anyCornerInObstruction = corners.some((corner) =>
      isPointInPolygon(corner.x, corner.y, obstruction.polygon)
    );

    // Check if any corner of the obstruction is inside the panel
    const anyObstructionCornerInPanel = obstruction.polygon.some((corner) =>
      isPointInPolygon(corner.x, corner.y, panelPolygon)
    );

    if (anyCornerInObstruction || anyObstructionCornerInPanel) {
      return { isValid: false, reason: "obstruction_overlap" };
    }
  }

  return { isValid: true };
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {Array} polygon - Array of polygon points {x, y}
 * @returns {boolean} - True if point is inside polygon
 */
function isPointInPolygon(x, y, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if ray from point crosses edge
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Get bounding box of a polygon
 * @param {Array} polygon - Array of points {x, y}
 * @returns {Object} - Bounding box {minX, minY, maxX, maxY}
 */
function getPolygonBounds(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
  };
}

/**
 * Convert rectangle coordinates to polygon points
 * @param {number} x - X coordinate of top-left corner
 * @param {number} y - Y coordinate of top-left corner
 * @param {number} width - Width of rectangle
 * @param {number} height - Height of rectangle
 * @returns {Array} - Array of points defining the rectangle polygon
 */
function rectangleToPolygon(x, y, width, height) {
  return [
    { x: x, y: y }, // top-left
    { x: x + width, y: y }, // top-right
    { x: x + width, y: y + height }, // bottom-right
    { x: x, y: y + height }, // bottom-left
  ];
}

/**
 * Fit a plane to 3D points using least squares method
 * @param {Array} points - Array of {x,y,z} points
 * @param {Object} dimensions - Real-world dimensions
 * @returns {Object} - Fitted plane parameters
 */
function fitPlaneToPoints(points, dimensions) {
  // Convert pixel coordinates to meters
  const points3D = points.map((p) => ({
    x: p.x * dimensions.metersPerPixelX,
    y: p.y * dimensions.metersPerPixelY,
    z: p.z, // Height in meters
  }));

  // Calculate centroid
  const centroid = {
    x: points3D.reduce((sum, p) => sum + p.x, 0) / points3D.length,
    y: points3D.reduce((sum, p) => sum + p.y, 0) / points3D.length,
    z: points3D.reduce((sum, p) => sum + p.z, 0) / points3D.length,
  };

  // Create covariance matrix components
  let xx = 0,
    xy = 0,
    xz = 0,
    yy = 0,
    yz = 0;

  for (const p of points3D) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;

    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
  }

  // Solve for normal vector using least squares
  const det_x = yy * xz - xy * yz;
  const det_y = xy * xz - xx * yz;
  const det = xx * yy - xy * xy;

  // Avoid division by zero
  if (Math.abs(det) < 1e-10) {
    // Can't fit plane reliably, return default
    return {
      avgSlope: Math.sqrt(xz * xz + yz * yz),
      normalVector: { x: 0, y: 0, z: 1 },
    };
  }

  const a = det_x / det;
  const b = det_y / det;

  // Normal vector of the plane
  const normalVector = { x: a, y: b, z: 1 };

  // Calculate overall slope
  const avgSlope = Math.sqrt(a * a + b * b);

  return { avgSlope, normalVector };
}

/**
 * Check block slope using DSM data with enhanced global slope matching
 * @param {Array} dsmRaster - DSM raster data
 * @param {number} x - Block top-left X
 * @param {number} y - Block top-left Y
 * @param {number} width - Block width
 * @param {number} height - Block height
 * @param {Object} dimensions - Real-world dimensions
 * @param {number} baselineSlope - Expected slope from roof segment metadata
 * @param {number} maxLocalDeviation - Maximum allowed local deviation in degrees
 * @returns {Object} - Validation result
 */
function checkBlockSlope(
  dsmRaster,
  x,
  y,
  width,
  height,
  dimensions,
  baselineSlope,
  maxLocalDeviation
) {
  // Configurable threshold for global slope deviation (in degrees)
  const MAX_GLOBAL_SLOPE_DEVIATION = 14;

  // If DSM data is missing, assume block is valid
  if (!dsmRaster || !dimensions) {
    return { isValid: true, deviation: 0, avgSlope: baselineSlope };
  }

  try {
    // Sample points in a grid pattern for better slope estimation
    const dsmValues = [];
    const dsmPoints = [];
    let totalValid = 0;

    // Use a 3x3 grid for sampling
    const numSamplesX = 3;
    const numSamplesY = 3;

    for (let sy = 0; sy < numSamplesY; sy++) {
      for (let sx = 0; sx < numSamplesX; sx++) {
        const pointX = x + Math.floor((sx * width) / (numSamplesX - 1));
        const pointY = y + Math.floor((sy * height) / (numSamplesY - 1));

        // Skip if outside image bounds
        if (
          pointX < 0 ||
          pointY < 0 ||
          pointX >= dimensions.pixelWidth ||
          pointY >= dimensions.pixelHeight
        ) {
          continue;
        }

        // Get DSM value at this point
        const index = pointY * dimensions.pixelWidth + pointX;

        if (index >= 0 && index < dsmRaster.length) {
          const value = dsmRaster[index];

          if (value !== undefined && !isNaN(value)) {
            dsmValues.push(value);
            dsmPoints.push({ x: pointX, y: pointY, z: value });
            totalValid++;
          }
        }
      }
    }

    // Need at least 4 valid points to calculate slope reliably
    if (totalValid < 4) {
      return { isValid: true, deviation: 0, avgSlope: baselineSlope };
    }

    // PART 1: Check for local slope consistency (sudden height changes)
    const minHeight = Math.min(...dsmValues);
    const maxHeight = Math.max(...dsmValues);
    const heightDiff = maxHeight - minHeight;

    // Convert height difference to slope angle for local consistency check
    const blockDiagonalLength = Math.sqrt(
      Math.pow(width * dimensions.metersPerPixelX, 2) +
        Math.pow(height * dimensions.metersPerPixelY, 2)
    );

    // Calculate slope based on min/max difference (local consistency)
    const localVarianceSlope = heightDiff / blockDiagonalLength;

    // PART 2: Calculate global average slope using plane fitting
    const { avgSlope, normalVector } = fitPlaneToPoints(dsmPoints, dimensions);

    // Convert slopes to angles for comparison
    const baselineAngle = (Math.atan(baselineSlope) * 180) / Math.PI;
    const localVarianceAngle = (Math.atan(localVarianceSlope) * 180) / Math.PI;
    const avgAngle = (Math.atan(avgSlope) * 180) / Math.PI;

    // Calculate deviations
    const localDeviation = Math.abs(localVarianceAngle - baselineAngle);
    const globalDeviation = Math.abs(avgAngle - baselineAngle);

    // Block is valid if both local and global deviations are acceptable
    const isLocalValid = localDeviation <= maxLocalDeviation;
    const isGlobalValid = globalDeviation <= MAX_GLOBAL_SLOPE_DEVIATION;
    const isValid = isLocalValid && isGlobalValid;

    return {
      isValid,
      localDeviation,
      globalDeviation,
      avgSlope,
      baselineAngle,
      avgAngle,
      type: !isLocalValid
        ? "local_variance"
        : !isGlobalValid
        ? "global_mismatch"
        : "valid",
    };
  } catch (error) {
    console.error(`Error checking block slope: ${error.message}`);
    // Return valid as default in case of error
    return { isValid: true, deviation: 0, avgSlope: baselineSlope };
  }
}

/**
 * Calculate real-world dimensions from the image and building data
 * @param {Object} rgbResult - Processed RGB data
 * @param {Object} buildingInsights - Building insights data
 * @returns {Object} - Real-world dimensions in meters
 */
function calculateRealWorldDimensions(rgbResult, buildingInsights) {
  try {
    // Extract pixel dimensions
    const pixelWidth = rgbResult.metadata?.dimensions?.width || 0;
    const pixelHeight = rgbResult.metadata?.dimensions?.height || 0;

    if (pixelWidth === 0 || pixelHeight === 0) {
      throw new Error("Invalid pixel dimensions");
    }

    // Get building bounding box from insights
    const boundingBox = buildingInsights.boundingBox;

    if (!boundingBox || !boundingBox.ne || !boundingBox.sw) {
      throw new Error("Building bounding box not available");
    }

    // Calculate real-world width and height using Haversine formula
    const earthRadius = 6371000; // meters

    // Calculate width (east-west distance)
    const dLng =
      ((boundingBox.ne.longitude - boundingBox.sw.longitude) * Math.PI) / 180;
    const lat =
      (((boundingBox.ne.latitude + boundingBox.sw.latitude) / 2) * Math.PI) /
      180;
    const width = earthRadius * Math.cos(lat) * dLng;

    // Calculate height (north-south distance)
    const dLat =
      ((boundingBox.ne.latitude - boundingBox.sw.latitude) * Math.PI) / 180;
    const height = earthRadius * dLat;

    // Calculate meters per pixel
    const metersPerPixelX = width / pixelWidth;
    const metersPerPixelY = height / pixelHeight;

    console.log(
      `Calculated real-world dimensions: ${width.toFixed(
        2
      )}m x ${height.toFixed(2)}m`
    );
    console.log(
      `Meters per pixel: X=${metersPerPixelX.toFixed(
        3
      )}m/px, Y=${metersPerPixelY.toFixed(3)}m/px`
    );

    return {
      width,
      height,
      metersPerPixelX,
      metersPerPixelY,
      pixelWidth,
      pixelHeight,
    };
  } catch (error) {
    console.error(`Error calculating real-world dimensions: ${error.message}`);
    // Return default values based on typical urban aerial imagery resolution
    return {
      width: 50,
      height: 50,
      metersPerPixelX: 0.1,
      metersPerPixelY: 0.1,
      pixelWidth: 500,
      pixelHeight: 500,
    };
  }
}

// Export the module functions
module.exports = {
  generateOptimalPanelLayout,
  calculateRealWorldDimensions,
  STANDARD_PANEL_WIDTH,
  STANDARD_PANEL_HEIGHT,
  PANEL_SPACING,
};
