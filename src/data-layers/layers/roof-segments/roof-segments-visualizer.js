/**
 * Roof segment visualizer for SolarScanner data-layers module
 *
 * Creates visualizations of roof segments from processed BuildingInsights data,
 * allowing for interactive selection of segments.
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
   * @param {string} [options.colorMode='suitability'] - How to color segments ('suitability', 'orientation', 'sunshine')
   * @param {number} [options.selectedSegmentId] - ID of the selected segment, if any
   * @param {boolean} [options.showLabels=false] - Whether to show segment ID labels
   * @param {string} [options.overlayMode='normal'] - Overlay mode ('normal', 'highlighted', 'interactive')
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
        const colorMode = options.colorMode || "suitability";
        const showLabels = options.showLabels || false;
        const selectedSegmentId = options.selectedSegmentId;
        const overlayMode = options.overlayMode || "normal";

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
        roofSegments.forEach((segment) => {
          const isSelected =
            selectedSegmentId !== undefined && segment.id === selectedSegmentId;
          this.drawRoofSegment(
            ctx,
            segment,
            bounds,
            { width, height },
            {
              colorMode,
              isSelected,
              overlayMode,
            }
          );
        });

        // Add segment labels if requested
        if (showLabels) {
          this.addSegmentLabels(ctx, roofSegments, bounds, { width, height });
        }

        // Add a legend if needed
        if (options.showLegend) {
          this.addColorLegend(ctx, { width, height }, colorMode);
        }

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
   * Draw a single roof segment on the canvas
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} segment - Roof segment data
   * @param {Object} bounds - Geographic bounds for coordinate conversion
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   * @param {Object} options - Drawing options
   */
  drawRoofSegment(ctx, segment, bounds, canvasSize, options = {}) {
    try {
      const {
        colorMode = "suitability",
        isSelected = false,
        overlayMode = "normal",
      } = options;

      // Convert roof segment corners to pixel coordinates
      const pixelCoords = segment.corners.map((corner) =>
        this.geoToPixelCoords(corner, bounds, canvasSize)
      );

      // Begin drawing path
      ctx.beginPath();
      ctx.moveTo(pixelCoords[0].x, pixelCoords[0].y);

      // Draw polygon
      for (let i = 1; i < pixelCoords.length; i++) {
        ctx.lineTo(pixelCoords[i].x, pixelCoords[i].y);
      }
      ctx.closePath();

      // Get fill color based on color mode
      let fillColor;
      switch (colorMode) {
        case "orientation":
          // Color based on roof orientation (azimuth)
          fillColor = this.getOrientationColor(segment.azimuth);
          break;
        case "sunshine":
          // Color based on sunshine hours (if available)
          if (segment.sunshineHours && segment.sunshineHours.median) {
            fillColor = this.getSunshineColor(segment.sunshineHours.median);
          } else {
            fillColor = this.getSuitabilityColor(segment.suitability);
          }
          break;
        case "pitch":
          // Color based on roof pitch
          fillColor = this.getPitchColor(segment.pitch);
          break;
        case "suitability":
        default:
          // Color based on overall suitability score
          fillColor = this.getSuitabilityColor(segment.suitability);
          break;
      }

      // Apply fill based on overlay mode
      let fillOpacity = 0.5; // Default opacity

      if (overlayMode === "highlighted") {
        // Higher opacity for highlighted mode
        fillOpacity = 0.7;
      } else if (overlayMode === "interactive") {
        // Lower base opacity for interactive mode, but selected segments get higher opacity
        fillOpacity = isSelected ? 0.8 : 0.3;
      }

      // Set fill style with appropriate opacity
      ctx.fillStyle = this.getRgbaFromRgb(fillColor, fillOpacity);
      ctx.fill();

      // Draw border
      if (isSelected) {
        // Thicker, highlighted border for selected segment
        ctx.strokeStyle = "#FFFF00";
        ctx.lineWidth = 3;
      } else {
        // Normal border
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    } catch (error) {
      console.error(
        `[RoofSegmentVisualizer] Error drawing segment ${segment.id}: ${error.message}`
      );
      // Continue with other segments
    }
  }

  /**
   * Add labels for each roof segment
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} roofSegments - Array of roof segments
   * @param {Object} bounds - Geographic bounds for coordinate conversion
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   */
  addSegmentLabels(ctx, roofSegments, bounds, canvasSize) {
    roofSegments.forEach((segment) => {
      // Convert center coordinates to pixels
      const center = this.geoToPixelCoords(segment.center, bounds, canvasSize);

      // Draw label background
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, 10, 0, Math.PI * 2);
      ctx.fill();

      // Draw label text
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(segment.id.toString(), center.x, center.y);
    });
  }

  /**
   * Add a color legend to the visualization
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} canvasSize - Canvas dimensions {width, height}
   * @param {string} colorMode - Current color mode
   */
  addColorLegend(ctx, canvasSize, colorMode) {
    const { width, height } = canvasSize;

    // Position the legend in the bottom right corner
    const legendWidth = 150;
    const legendHeight = 30;
    const x = width - legendWidth - 10;
    const y = height - legendHeight - 10;

    // Draw legend background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(x, y, legendWidth, legendHeight);

    // Draw color gradient
    const gradientWidth = legendWidth - 20;
    const gradientHeight = 10;
    const gradientX = x + 10;
    const gradientY = y + 10;

    // Create gradient
    const gradient = ctx.createLinearGradient(
      gradientX,
      0,
      gradientX + gradientWidth,
      0
    );

    // Add color stops based on the current color mode
    if (colorMode === "suitability") {
      // Low to high suitability
      gradient.addColorStop(
        0,
        this.getRgbaFromRgb(this.getSuitabilityColor(0), 1)
      );
      gradient.addColorStop(
        0.5,
        this.getRgbaFromRgb(this.getSuitabilityColor(0.5), 1)
      );
      gradient.addColorStop(
        1,
        this.getRgbaFromRgb(this.getSuitabilityColor(1), 1)
      );
    } else if (colorMode === "orientation") {
      // Different orientations
      gradient.addColorStop(
        0,
        this.getRgbaFromRgb(this.getOrientationColor(0), 1)
      ); // North
      gradient.addColorStop(
        0.25,
        this.getRgbaFromRgb(this.getOrientationColor(90), 1)
      ); // East
      gradient.addColorStop(
        0.5,
        this.getRgbaFromRgb(this.getOrientationColor(180), 1)
      ); // South
      gradient.addColorStop(
        0.75,
        this.getRgbaFromRgb(this.getOrientationColor(270), 1)
      ); // West
      gradient.addColorStop(
        1,
        this.getRgbaFromRgb(this.getOrientationColor(359), 1)
      ); // North again
    } else if (colorMode === "sunshine") {
      // Low to high sunshine
      gradient.addColorStop(
        0,
        this.getRgbaFromRgb(this.getSunshineColor(800), 1)
      );
      gradient.addColorStop(
        0.5,
        this.getRgbaFromRgb(this.getSunshineColor(1400), 1)
      );
      gradient.addColorStop(
        1,
        this.getRgbaFromRgb(this.getSunshineColor(2000), 1)
      );
    } else if (colorMode === "pitch") {
      // Flat to steep pitch
      gradient.addColorStop(0, this.getRgbaFromRgb(this.getPitchColor(0), 1));
      gradient.addColorStop(
        0.5,
        this.getRgbaFromRgb(this.getPitchColor(25), 1)
      );
      gradient.addColorStop(1, this.getRgbaFromRgb(this.getPitchColor(50), 1));
    }

    // Draw gradient rectangle
    ctx.fillStyle = gradient;
    ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

    // Draw legend title
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    let legendTitle;
    switch (colorMode) {
      case "orientation":
        legendTitle = "Orientation (N → E → S → W → N)";
        break;
      case "sunshine":
        legendTitle = "Annual Sunshine Hours (Low → High)";
        break;
      case "pitch":
        legendTitle = "Roof Pitch (Flat → Steep)";
        break;
      case "suitability":
      default:
        legendTitle = "Solar Suitability (Low → High)";
        break;
    }

    ctx.fillText(legendTitle, x + legendWidth / 2, y + 2);
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
   * Get color for a suitability score
   * @private
   * @param {number} suitability - Suitability score (0-1)
   * @returns {string} - RGB color string
   */
  getSuitabilityColor(suitability) {
    // Use the IRON palette for suitability (from ColorPalettes utility)
    const palette = ColorPalettes.getPalette("IRON", 100);
    const index = Math.min(99, Math.max(0, Math.floor(suitability * 99)));
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
   * Get color for sunshine hours
   * @private
   * @param {number} hours - Annual sunshine hours (typically 800-2000)
   * @returns {string} - RGB color string
   */
  getSunshineColor(hours) {
    // Use SUNLIGHT palette from ColorPalettes
    const palette = ColorPalettes.getPalette("SUNLIGHT", 100);

    // Normalize hours between 0-1 for palette lookup
    // Assuming range of 800-2000 hours for normalization
    const normalizedValue = Math.min(1, Math.max(0, (hours - 800) / 1200));
    const index = Math.min(99, Math.max(0, Math.floor(normalizedValue * 99)));
    const color = palette[index];

    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  /**
   * Get color for roof pitch
   * @private
   * @param {number} pitch - Roof pitch in degrees (typically 0-60)
   * @returns {string} - RGB color string
   */
  getPitchColor(pitch) {
    // Simple gradient for pitch
    // Blue (flat) to green (medium) to red (steep)
    const r = Math.min(255, Math.max(0, Math.floor(pitch * 5.1)));
    const g = Math.min(255, Math.max(0, 255 - Math.abs(pitch - 25) * 8));
    const b = Math.min(255, Math.max(0, 255 - pitch * 4.25));

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Convert RGB color string to RGBA with specified opacity
   * @private
   * @param {string} rgbColor - RGB color string (e.g. 'rgb(255, 0, 0)')
   * @param {number} opacity - Opacity value (0-1)
   * @returns {string} - RGBA color string
   */
  getRgbaFromRgb(rgbColor, opacity) {
    // Extract RGB values from the string
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
