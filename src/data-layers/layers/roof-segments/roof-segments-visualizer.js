/**
 * Roof segment visualizer for SolarScanner data-layers module
 *
 * Creates visualizations of roof segments from processed BuildingInsights data,
 * allowing for interactive selection of segments. Uses bounding boxes with inferred
 * corners and colors segments by orientation, with special handling for horizontal roofs.
 * Supports visualizing grouped segments.
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const config = require("../../config");

/**
 * Visualizer implementation for roof segment data
 * @extends Visualizer
 */
class RoofSegmentVisualizer extends Visualizer {
  /**
   * Create a new RoofSegmentVisualizer
   */
  constructor() {
    super();
    console.log("[RoofSegmentVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "roofSegments";
  }

  /**
   * Create a visualization from processed roof segment data
   * @param {Object} processedData - The processed roof segment data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @returns {Promise<string>} - Data URL of the visualization
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log(
          "[RoofSegmentVisualizer] Creating visualization from roof segment data"
        );

        // Validate processed data
        this.validateProcessedData(processedData, ["roofSegments", "bounds"]);

        // Get data from processed result
        const { roofSegments, bounds, center } = processedData;

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;

        // Calculate dimensions based on bounds aspect ratio
        const { width, height } = this.calculateDimensions(
          bounds,
          maxDimension
        );

        // Create canvas and context
        const { canvas, ctx } = this.createEmptyCanvas(width, height, {
          transparent: true,
        });

        // Draw all roof segments
        let visibleSegments = 0;
        let visibleGroupedSegments = 0;

        // Draw non-grouped segments first, then grouped segments on top
        const sortedSegments = [...roofSegments].sort((a, b) => {
          // Draw grouped segments after non-grouped ones
          return (a.isGroup ? 1 : 0) - (b.isGroup ? 1 : 0);
        });

        sortedSegments.forEach((segment) => {
          // Determine if this is a grouped segment
          const isGroupedSegment = segment.isGroup === true;

          if (isGroupedSegment) {
            this.drawGroupedSegment(ctx, segment, bounds, { width, height });
            visibleGroupedSegments++;
          } else {
            this.drawRoofSegment(ctx, segment, bounds, { width, height });
          }
          visibleSegments++;
        });

        console.log(
          `[RoofSegmentVisualizer] Visualized ${visibleSegments} segments (including ${visibleGroupedSegments} grouped segments)`
        );

        // Convert canvas to data URL
        const dataUrl = this.canvasToDataURL(canvas, {
          mimeType: "image/png",
          quality: options.quality || config.visualization.PNG_QUALITY,
        });

        console.log(
          "[RoofSegmentVisualizer] Roof segment visualization complete"
        );

        return dataUrl;
      });
    } catch (error) {
      // Handle visualization error with fallback
      return this.handleVisualizationError(
        error,
        "visualize",
        {
          layerType: "roofSegments",
          options,
          width: options.maxDimension || 400,
          height: options.maxDimension || 400,
        },
        { createFallback: true }
      );
    }
  }

  /**
   * Calculate canvas dimensions based on geographic bounds and max dimension
   * @private
   * @param {Object} bounds - Geographic bounds {north, south, east, west}
   * @param {number} maxDimension - Maximum dimension allowed
   * @returns {Object} - Calculated dimensions {width, height}
   */
  calculateDimensions(bounds, maxDimension) {
    const { north, south, east, west } = bounds;

    // Calculate aspect ratio (width / height)
    // Note: we need to account for the cosine of the latitude when calculating
    // the aspect ratio to avoid distortion
    const midLat = (north + south) / 2;
    const latCosine = Math.cos((midLat * Math.PI) / 180);

    const lngDiff = (east - west) * latCosine;
    const latDiff = north - south;

    const aspectRatio = lngDiff / latDiff;

    // Determine width and height based on aspect ratio and max dimension
    let width, height;
    if (aspectRatio >= 1) {
      // Wider than tall
      width = maxDimension;
      height = Math.floor(width / aspectRatio);
    } else {
      // Taller than wide
      height = maxDimension;
      width = Math.floor(height * aspectRatio);
    }

    return { width, height };
  }

  /**
   * Draw a single roof segment on the canvas as a polygon
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} segment - Roof segment data
   * @param {Object} bounds - Geographic bounds for coordinate conversion
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   */
  drawRoofSegment(ctx, segment, bounds, canvasSize) {
    try {
      // Check that we have corners (these should be inferred by the processor)
      if (!segment.corners || segment.corners.length < 3) {
        console.warn(
          `[RoofSegmentVisualizer] Segment ${segment.id} doesn't have enough corner points`
        );
        return;
      }

      // Convert roof segment corners to pixel coordinates
      const pixelCoords = segment.corners.map((corner) =>
        this.geoToPixelCoords(corner, bounds, canvasSize)
      );

      // Begin drawing the polygon
      ctx.beginPath();
      ctx.moveTo(pixelCoords[0].x, pixelCoords[0].y);

      // Draw the polygon by connecting all corners
      for (let i = 1; i < pixelCoords.length; i++) {
        ctx.lineTo(pixelCoords[i].x, pixelCoords[i].y);
      }

      // Close the path
      ctx.closePath();

      // Get fill color based on orientation and horizontal status
      let fillColor;
      if (segment.isHorizontal) {
        // Use gray for horizontal segments (pitch <= 5 degrees)
        fillColor = "#808080"; // Gray
      } else {
        // Use orientation color for other segments
        fillColor = this.getOrientationColor(segment.azimuth);
      }

      // Set fill style with default opacity
      const fillOpacity = 0.5;
      ctx.fillStyle = this.getRgbaFromRgb(fillColor, fillOpacity);
      ctx.fill();
    } catch (error) {
      console.error(
        `[RoofSegmentVisualizer] Error drawing segment ${segment.id}: ${error.message}`
      );
    }
  }

  /**
   * Draw a grouped roof segment on the canvas
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} segment - Grouped segment data
   * @param {Object} bounds - Geographic bounds for coordinate conversion
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   */
  drawGroupedSegment(ctx, segment, bounds, canvasSize) {
    try {
      // Instead of drawing all component segments, draw a single bounding box
      // that encompasses all components of the group

      // First, determine the overall bounds of the group
      if (segment.boundingBox) {
        // If segment already has an overall boundingBox property, use it directly
        const sw = segment.boundingBox.sw;
        const ne = segment.boundingBox.ne;

        // Convert corners to pixel coordinates
        const pixelCoords = [
          this.geoToPixelCoords(sw, bounds, canvasSize), // Southwest
          this.geoToPixelCoords(
            { latitude: sw.latitude, longitude: ne.longitude },
            bounds,
            canvasSize
          ), // Southeast
          this.geoToPixelCoords(ne, bounds, canvasSize), // Northeast
          this.geoToPixelCoords(
            { latitude: ne.latitude, longitude: sw.longitude },
            bounds,
            canvasSize
          ), // Northwest
        ];

        // Draw the simplified rectangle with slightly higher opacity for grouped segments
        this.drawPolygon(
          ctx,
          pixelCoords,
          segment.isHorizontal,
          segment.azimuth,
          0.6
        );
      } else {
        console.warn(
          `[RoofSegmentVisualizer] Grouped segment ${segment.id} doesn't have a boundingBox`
        );
      }
    } catch (error) {
      console.error(
        `[RoofSegmentVisualizer] Error drawing grouped segment ${segment.id}: ${error.message}`
      );
    }
  }

  /**
   * Draw a polygon with the appropriate fill color
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} pixelCoords - Array of pixel coordinates
   * @param {boolean} isHorizontal - Whether this is a horizontal roof
   * @param {number} azimuth - Azimuth angle for color determination
   * @param {number} opacity - Fill opacity
   */
  drawPolygon(ctx, pixelCoords, isHorizontal, azimuth, opacity = 0.5) {
    // Begin drawing the polygon
    ctx.beginPath();
    ctx.moveTo(pixelCoords[0].x, pixelCoords[0].y);

    // Draw the polygon by connecting all corners
    for (let i = 1; i < pixelCoords.length; i++) {
      ctx.lineTo(pixelCoords[i].x, pixelCoords[i].y);
    }

    // Close the path
    ctx.closePath();

    // Get fill color based on orientation and horizontal status
    let fillColor;
    if (isHorizontal) {
      // Use gray for horizontal segments (pitch <= 5 degrees)
      fillColor = "#808080"; // Gray
    } else {
      // Use orientation color for other segments
      fillColor = this.getOrientationColor(azimuth);
    }

    // Set fill style with the provided opacity
    ctx.fillStyle = this.getRgbaFromRgb(fillColor, opacity);
    ctx.fill();
  }

  /**
   * Get color for roof orientation (azimuth)
   * @private
   * @param {number} azimuth - Azimuth in degrees (0-360)
   * @returns {string} - RGB color string
   */
  getOrientationColor(azimuth) {
    // Use the RAINBOW palette for orientation
    const palette = ColorPalettes.getPalette("RAINBOW", 360);
    const index = Math.min(359, Math.max(0, Math.floor(azimuth % 360)));
    const color = palette[index];

    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  /**
   * Get color for roof orientation (azimuth)
   * @private
   * @param {number} azimuth - Azimuth in degrees (0-360)
   * @returns {string} - RGB color string
   */
  getOrientationColor(azimuth) {
    // Use the RAINBOW palette for orientation
    const palette = ColorPalettes.getPalette("RAINBOW", 360);
    const index = Math.min(359, Math.max(0, Math.floor(azimuth % 360)));
    const color = palette[index];

    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  /**
   * Convert geographic coordinates to pixel coordinates
   * @private
   * @param {Object} geoCoord - Geographic coordinates {latitude, longitude}
   * @param {Object} bounds - Geographic bounds {north, south, east, west}
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   * @returns {Object} - Pixel coordinates {x, y}
   */
  geoToPixelCoords(geoCoord, bounds, canvasSize) {
    const { width, height } = canvasSize;
    const { north, south, east, west } = bounds;

    // Longitude to X (left to right)
    const x = (width * (geoCoord.longitude - west)) / (east - west);

    // Latitude to Y (top to bottom) - note that y increases downward in the canvas
    const y = (height * (north - geoCoord.latitude)) / (north - south);

    return { x, y };
  }

  /**
   * Convert RGB color string to RGBA with specified opacity
   * @private
   * @param {string} rgbColor - RGB color string (e.g. 'rgb(255, 0, 0)')
   * @param {number} opacity - Opacity value (0-1)
   * @returns {string} - RGBA color string
   */
  getRgbaFromRgb(rgbColor, opacity) {
    // Handle hex colors
    if (rgbColor.startsWith("#")) {
      const r = parseInt(rgbColor.slice(1, 3), 16);
      const g = parseInt(rgbColor.slice(3, 5), 16);
      const b = parseInt(rgbColor.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    // Handle rgb colors
    const matches = rgbColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (matches) {
      const [, r, g, b] = matches;
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    // If pattern doesn't match, return the original color
    return rgbColor;
  }
}

module.exports = RoofSegmentVisualizer;
