/**
 * Mask layer visualizer for SolarScanner data-layers module
 *
 * Creates visualizations from processed mask layer data, showing building outlines.
 */

const Visualizer = require("../../core/visualizer");
const ColorPalettes = require("../../utils/color-palettes");
const config = require("../../config");

/**
 * Visualizer implementation for mask layer data
 * @extends Visualizer
 */
class MaskVisualizer extends Visualizer {
  /**
   * Create a new MaskVisualizer
   */
  constructor() {
    super();
    console.log("[MaskVisualizer] Initialized");
  }

  /**
   * Check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   */
  canHandle(layerType) {
    return layerType === "mask";
  }

  /**
   * Create a visualization from processed mask data
   * @param {Object} processedData - The processed mask data
   * @param {Object} options - Visualization options
   * @param {boolean} [options.buildingFocus=true] - Whether to focus on building boundaries
   * @param {number} [options.maxDimension=400] - Maximum dimension for the output image
   * @param {Array<Object>} [options.palette] - Custom color palette to use
   * @param {string} [options.paletteName='BINARY'] - Name of predefined palette to use
   * @param {string} [options.buildingColor] - Custom color for buildings (hex or rgba)
   * @param {string} [options.backgroundColor] - Custom color for background (hex or rgba)
   * @returns {Promise<string>} - Data URL of the visualization
   * @throws {Error} if visualization fails
   */
  async visualize(processedData, options = {}) {
    try {
      return await this.timeOperation("visualize", async () => {
        console.log("[MaskVisualizer] Creating visualization from mask data");

        // Validate processed data
        this.validateProcessedData(processedData, ["raster", "metadata"]);

        // Get data from processed result
        const { raster, metadata, buildingBoundaries } = processedData;
        const { width, height } = metadata;

        // Set visualization options
        const buildingFocus = options.buildingFocus !== false;
        const maxDimension =
          options.maxDimension || config.visualization.MAX_DIMENSION;

        // Determine the color palette
        let palette;
        if (options.palette) {
          palette = options.palette;
        } else {
          const paletteName = options.paletteName || "BINARY";
          palette = ColorPalettes.getPalette(paletteName);
        }

        // Determine dimensions and cropping
        let outputWidth, outputHeight, startX, startY;
        let croppedData;

        if (buildingFocus && buildingBoundaries?.hasBuilding) {
          // Use building boundaries for cropping
          console.log(
            "[MaskVisualizer] Using building focus for visualization"
          );

          const {
            minX,
            minY,
            width: bWidth,
            height: bHeight,
          } = buildingBoundaries;
          startX = minX;
          startY = minY;
          outputWidth = bWidth;
          outputHeight = bHeight;

          // Create cropped data array
          croppedData = new Array(outputWidth * outputHeight);
          for (let y = 0; y < outputHeight; y++) {
            for (let x = 0; x < outputWidth; x++) {
              const srcIdx = (startY + y) * width + (startX + x);
              const destIdx = y * outputWidth + x;
              croppedData[destIdx] = raster[srcIdx];
            }
          }
        } else {
          // Use full image
          console.log("[MaskVisualizer] Using full image for visualization");
          startX = 0;
          startY = 0;
          outputWidth = width;
          outputHeight = height;
          croppedData = raster;
        }

        // Apply max dimension limit if needed
        if (outputWidth > maxDimension || outputHeight > maxDimension) {
          const aspectRatio = outputWidth / outputHeight;
          if (outputWidth > outputHeight) {
            outputWidth = maxDimension;
            outputHeight = Math.round(maxDimension / aspectRatio);
          } else {
            outputHeight = maxDimension;
            outputWidth = Math.round(maxDimension * aspectRatio);
          }
          console.log(
            `[MaskVisualizer] Resized to ${outputWidth}x${outputHeight} to fit max dimension`
          );
        }

        // Create canvas and context
        const { canvas, ctx } = this.createEmptyCanvas(
          outputWidth,
          outputHeight,
          {
            transparent: true,
          }
        );

        // Set custom colors if provided
        const buildingColor = options.buildingColor
          ? this.parseColor(options.buildingColor)
          : palette[1];
        const backgroundColor = options.backgroundColor
          ? this.parseColor(options.backgroundColor)
          : null;

        // Create scaled image data
        const imageData = ctx.createImageData(outputWidth, outputHeight);
        const scaleX = ((croppedData.length / width) * width) / outputWidth;
        const scaleY = ((croppedData.length / height) * height) / outputHeight;

        // Fill the image data
        for (let y = 0; y < outputHeight; y++) {
          for (let x = 0; x < outputWidth; x++) {
            // Calculate source index with scaling
            const srcX = Math.floor(x * scaleX);
            const srcY = Math.floor(y * scaleY);
            const srcIdx = srcY * (outputWidth * scaleX) + srcX;

            // Get the mask value (threshold is typically > 0 for buildings)
            const maskValue = croppedData[srcIdx];

            // Calculate destination index
            const destIdx = (y * outputWidth + x) * 4;

            if (maskValue > 0) {
              // Building pixel
              imageData.data[destIdx] = buildingColor.r;
              imageData.data[destIdx + 1] = buildingColor.g;
              imageData.data[destIdx + 2] = buildingColor.b;
              imageData.data[destIdx + 3] = 255; // Fully opaque
            } else if (backgroundColor) {
              // Non-building pixel with background color
              imageData.data[destIdx] = backgroundColor.r;
              imageData.data[destIdx + 1] = backgroundColor.g;
              imageData.data[destIdx + 2] = backgroundColor.b;
              imageData.data[destIdx + 3] =
                backgroundColor.a !== undefined ? backgroundColor.a : 255;
            } else {
              // Transparent background
              imageData.data[destIdx + 3] = 0;
            }
          }
        }

        // Put the image data on the canvas
        ctx.putImageData(imageData, 0, 0);

        // Add a subtle building outline if requested
        if (options.showOutline) {
          this.addBuildingOutline(ctx, imageData, outputWidth, outputHeight);
        }

        // Convert canvas to data URL
        const dataUrl = this.canvasToDataURL(canvas, {
          mimeType: "image/png",
          quality: options.quality || config.visualization.PNG_QUALITY,
        });

        console.log("[MaskVisualizer] Mask visualization complete");

        return dataUrl;
      });
    } catch (error) {
      // Handle visualization error with fallback
      return this.handleVisualizationError(
        error,
        "visualize",
        {
          layerType: "mask",
          options,
          width: processedData?.metadata?.width || 400,
          height: processedData?.metadata?.height || 300,
        },
        { createFallback: true }
      );
    }
  }

  /**
   * Parse a color string into an RGB(A) object
   * @private
   * @param {string} color - Color string (hex or rgba)
   * @returns {Object} - RGB(A) color object
   */
  parseColor(color) {
    try {
      if (!color) {
        return { r: 0, g: 0, b: 0, a: 0 };
      }

      // Handle hex color
      if (color.startsWith("#") || /^[0-9a-fA-F]{6}$/.test(color)) {
        return ColorPalettes.hexToRgb(color);
      }

      // Handle rgba color
      if (color.startsWith("rgba(")) {
        const rgba = color.replace("rgba(", "").replace(")", "").split(",");
        return {
          r: parseInt(rgba[0].trim()),
          g: parseInt(rgba[1].trim()),
          b: parseInt(rgba[2].trim()),
          a: parseFloat(rgba[3].trim()) * 255,
        };
      }

      // Handle rgb color
      if (color.startsWith("rgb(")) {
        const rgb = color.replace("rgb(", "").replace(")", "").split(",");
        return {
          r: parseInt(rgb[0].trim()),
          g: parseInt(rgb[1].trim()),
          b: parseInt(rgb[2].trim()),
          a: 255,
        };
      }

      // Default to black
      console.warn(
        `[MaskVisualizer] Unrecognized color format: ${color}, defaulting to black`
      );
      return { r: 0, g: 0, b: 0, a: 255 };
    } catch (error) {
      console.error(`[MaskVisualizer] Error parsing color: ${error.message}`);
      return { r: 0, g: 0, b: 0, a: 255 };
    }
  }

  /**
   * Add a subtle outline around buildings on the mask
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {ImageData} imageData - Image data
   * @param {number} width - Image width
   * @param {number} height - Image height
   */
  addBuildingOutline(ctx, imageData, width, height) {
    try {
      // Create a temporary canvas for edge detection
      const { canvas: tempCanvas, ctx: tempCtx } = this.createEmptyCanvas(
        width,
        height
      );
      tempCtx.putImageData(imageData, 0, 0);

      // Set the outline style
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 1;

      // Use the existing alpha channel to find edges
      const pixels = imageData.data;

      // Simple edge detection
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          const idxUp = ((y - 1) * width + x) * 4;
          const idxDown = ((y + 1) * width + x) * 4;
          const idxLeft = (y * width + (x - 1)) * 4;
          const idxRight = (y * width + (x + 1)) * 4;

          // Check if this is an edge pixel (opaque pixel with transparent neighbor)
          if (
            pixels[idx + 3] > 200 &&
            (pixels[idxUp + 3] < 50 ||
              pixels[idxDown + 3] < 50 ||
              pixels[idxLeft + 3] < 50 ||
              pixels[idxRight + 3] < 50)
          ) {
            ctx.beginPath();
            ctx.arc(x, y, 0.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    } catch (error) {
      console.error(
        `[MaskVisualizer] Error adding building outline: ${error.message}`
      );
      // Continue without outline
    }
  }
}

module.exports = MaskVisualizer;
