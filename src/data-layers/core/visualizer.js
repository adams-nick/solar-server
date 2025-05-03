/**
 * Base Visualizer class for SolarScanner data-layers module
 *
 * This abstract base class provides the foundation for layer-specific visualizers.
 * It handles common validation and error management for visualization operations.
 */

const { createCanvas } = require("canvas");

/**
 * Abstract base class for all data layer visualizers
 */
class Visualizer {
  /**
   * Constructor for the visualizer
   * @throws {Error} when instantiated directly
   */
  constructor() {
    // Ensure abstract methods are implemented in subclasses
    if (this.constructor === Visualizer) {
      const error = new Error(
        "Cannot instantiate abstract Visualizer class directly"
      );
      console.error("[Visualizer] Instantiation error:", error.message);
      throw error;
    }

    if (this.visualize === Visualizer.prototype.visualize) {
      const error = new Error("Subclasses must implement visualize() method");
      console.error("[Visualizer] Implementation error:", error.message);
      throw error;
    }

    if (this.canHandle === Visualizer.prototype.canHandle) {
      const error = new Error("Subclasses must implement canHandle() method");
      console.error("[Visualizer] Implementation error:", error.message);
      throw error;
    }

    console.log(`[Visualizer] Created ${this.constructor.name}`);
  }

  /**
   * Abstract method to create a visualization from processed data
   * @param {Object} processedData - The processed data
   * @param {Object} options - Visualization options
   * @returns {Promise<string>} - Data URL or file path of the visualization
   * @throws {Error} when not implemented in subclass
   */
  async visualize(processedData, options = {}) {
    throw new Error("Method not implemented: visualize()");
  }

  /**
   * Abstract method to check if this visualizer can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this visualizer can handle the layer type
   * @throws {Error} when not implemented in subclass
   */
  canHandle(layerType) {
    throw new Error("Method not implemented: canHandle()");
  }

  /**
   * Validate processed data before visualization
   * @protected
   * @param {Object} processedData - Processed data to validate
   * @param {Array<string>} requiredProps - Required property names
   * @throws {Error} if validation fails
   */
  validateProcessedData(processedData, requiredProps = []) {
    if (!processedData) {
      throw new Error("Processed data is required for visualization");
    }

    for (const prop of requiredProps) {
      if (processedData[prop] === undefined) {
        throw new Error(`Processed data is missing required property: ${prop}`);
      }
    }
  }

  /**
   * Create an empty canvas with the specified dimensions
   * @protected
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {Object} options - Additional options
   * @returns {Object} - Canvas and context objects
   */
  createEmptyCanvas(width, height, options = {}) {
    try {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d");

      // Make background transparent by default
      if (options.transparent !== false) {
        ctx.clearRect(0, 0, width, height);
      } else if (options.backgroundColor) {
        // Fill with background color if specified
        ctx.fillStyle = options.backgroundColor;
        ctx.fillRect(0, 0, width, height);
      }

      return { canvas, ctx };
    } catch (error) {
      console.error(`[Visualizer] Error creating canvas: ${error.message}`);
      throw new Error(`Failed to create canvas: ${error.message}`);
    }
  }

  /**
   * Convert a canvas to a data URL
   * @protected
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} options - Options
   * @param {string} [options.mimeType='image/png'] - MIME type
   * @param {number} [options.quality=0.92] - Quality (for JPEG)
   * @returns {string} - Data URL
   */
  canvasToDataURL(canvas, options = {}) {
    try {
      const mimeType = options.mimeType || "image/png";
      const quality = options.quality || 0.92;

      const dataUrl = canvas.toDataURL(mimeType, quality);
      console.log(
        `[Visualizer] Created ${mimeType} data URL (${dataUrl.length} bytes)`
      );
      return dataUrl;
    } catch (error) {
      console.error(
        `[Visualizer] Error converting canvas to data URL: ${error.message}`
      );
      throw new Error(`Failed to convert canvas to data URL: ${error.message}`);
    }
  }

  /**
   * Log visualization timing information
   * @protected
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to time
   * @returns {Promise<any>} - Result of the function
   */
  async timeOperation(operation, fn) {
    const startTime = Date.now();
    try {
      console.log(
        `[Visualizer] Starting visualization operation: ${operation}`
      );
      const result = await fn();
      const duration = Date.now() - startTime;
      console.log(
        `[Visualizer] Completed visualization operation: ${operation} in ${duration}ms`
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[Visualizer] Failed visualization operation: ${operation} after ${duration}ms`
      );
      console.error(`[Visualizer] Error in ${operation}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle common visualization errors
   * @protected
   * @param {Error} error - The error to handle
   * @param {string} operation - The operation that failed
   * @param {Object} context - Additional context
   * @param {Object} options - Error handling options
   * @param {boolean} [options.createFallback=true] - Whether to create a fallback visualization
   * @returns {string|null} - Fallback visualization data URL or null
   * @throws {Error} Enhanced error with context if no fallback is created
   */
  handleVisualizationError(error, operation, context = {}, options = {}) {
    // Create a more informative error
    const layerType = context.layerType || "unknown";
    const enhancedMessage = `Error visualizing ${layerType} data in ${operation}: ${error.message}`;

    // Log detailed error information
    console.error(`[Visualizer] ${enhancedMessage}`);

    if (context.options) {
      console.error(
        "[Visualizer] Visualization options:",
        JSON.stringify(context.options, null, 2)
      );
    }

    if (error.stack) {
      console.error("[Visualizer] Error stack:", error.stack);
    }

    // Create fallback visualization if requested
    const createFallback = options.createFallback !== false;
    if (createFallback) {
      try {
        console.log("[Visualizer] Creating fallback visualization");
        return this.createFallbackVisualization(context, enhancedMessage);
      } catch (fallbackError) {
        console.error(
          `[Visualizer] Failed to create fallback visualization: ${fallbackError.message}`
        );
      }
    }

    // Throw enhanced error if no fallback was created
    const enhancedError = new Error(enhancedMessage);
    enhancedError.originalError = error;
    enhancedError.context = context;
    throw enhancedError;
  }

  /**
   * Create a fallback visualization when the main visualization fails
   * @protected
   * @param {Object} context - Context information
   * @param {string} errorMessage - Error message
   * @returns {string} - Data URL of the fallback visualization
   */
  createFallbackVisualization(
    context = {},
    errorMessage = "Visualization failed"
  ) {
    try {
      // Create a simple fallback canvas
      const width = context.width || 400;
      const height = context.height || 300;

      const { canvas, ctx } = this.createEmptyCanvas(width, height, {
        transparent: false,
        backgroundColor: "#f0f0f0",
      });

      // Draw error message
      ctx.fillStyle = "#666666";
      ctx.font = "16px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Draw layer type
      if (context.layerType) {
        ctx.font = "bold 20px Arial";
        ctx.fillText(context.layerType.toUpperCase(), width / 2, height / 3);
      }

      // Draw error icon
      ctx.font = "48px Arial";
      ctx.fillText("⚠️", width / 2, height / 2);

      // Draw error message (wrapped)
      ctx.font = "14px Arial";
      const maxLineLength = 40;
      const words = errorMessage.split(" ");
      let line = "";
      let lineY = (height * 2) / 3;

      for (const word of words) {
        const testLine = line + (line ? " " : "") + word;
        if (testLine.length > maxLineLength && line) {
          ctx.fillText(line, width / 2, lineY);
          line = word;
          lineY += 20;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, width / 2, lineY);

      // Add border
      ctx.strokeStyle = "#cccccc";
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, width - 20, height - 20);

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error(
        `[Visualizer] Error creating fallback visualization: ${error.message}`
      );

      // Return a simple encoded data URL as a last resort
      // This is a tiny transparent PNG
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFNAI0QOsUKgAAAABJRU5ErkJggg==";
    }
  }
}

module.exports = Visualizer;
