/**
 * Base Processor class for SolarScanner data-layers module
 *
 * This abstract base class provides the foundation for layer-specific processors.
 * It handles common validation and error management for data processing operations.
 */

/**
 * Abstract base class for all data layer processors
 */
class Processor {
  /**
   * Constructor for the processor
   * @throws {Error} when instantiated directly
   */
  constructor() {
    // Ensure abstract methods are implemented in subclasses
    if (this.constructor === Processor) {
      const error = new Error(
        "Cannot instantiate abstract Processor class directly"
      );
      console.error("[Processor] Instantiation error:", error.message);
      throw error;
    }

    if (this.process === Processor.prototype.process) {
      const error = new Error("Subclasses must implement process() method");
      console.error("[Processor] Implementation error:", error.message);
      throw error;
    }

    if (this.canHandle === Processor.prototype.canHandle) {
      const error = new Error("Subclasses must implement canHandle() method");
      console.error("[Processor] Implementation error:", error.message);
      throw error;
    }

    console.log(`[Processor] Created ${this.constructor.name}`);
  }

  /**
   * Abstract method to process raw data into a structured format
   * @param {Buffer} rawData - The raw data buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} - Processed data
   * @throws {Error} when not implemented in subclass
   */
  async process(rawData, options = {}) {
    throw new Error("Method not implemented: process()");
  }

  /**
   * Abstract method to check if this processor can handle the given layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if this processor can handle the layer type
   * @throws {Error} when not implemented in subclass
   */
  canHandle(layerType) {
    throw new Error("Method not implemented: canHandle()");
  }

  /**
   * Validate raw data before processing
   * @protected
   * @param {Buffer} rawData - Raw data to validate
   * @param {Object} options - Validation options
   * @throws {Error} if validation fails
   */
  /**
   * Validate raw data before processing
   * @protected
   * @param {Buffer} rawData - Raw data to validate
   * @param {Object} options - Validation options
   * @throws {Error} if validation fails
   */
  validateRawData(rawData, options = {}) {
    if (!rawData) {
      throw new Error("Raw data is required for processing");
    }

    // Log the type of the raw data for debugging
    console.log(
      `[Processor] Raw data type: ${typeof rawData}, instanceof Buffer: ${
        rawData instanceof Buffer
      }, instanceof ArrayBuffer: ${
        rawData instanceof ArrayBuffer
      }, instanceof Uint8Array: ${rawData instanceof Uint8Array}, byteLength: ${
        rawData.byteLength || "N/A"
      }`
    );

    if (
      !(rawData instanceof Buffer) &&
      !(rawData instanceof ArrayBuffer) &&
      !(rawData instanceof Uint8Array)
    ) {
      throw new Error(
        `Raw data must be a Buffer, ArrayBuffer, or Uint8Array, got: ${typeof rawData}`
      );
    }

    if (rawData.byteLength === 0) {
      throw new Error("Raw data cannot be empty");
    }

    // Check for minimum size if specified in options
    if (options.minSize && rawData.byteLength < options.minSize) {
      throw new Error(
        `Raw data size (${rawData.byteLength} bytes) is below minimum required size (${options.minSize} bytes)`
      );
    }

    // Additional format validation could be added here
    if (options.validateFormat) {
      this.validateDataFormat(rawData, options);
    }
  }

  /**
   * Validate data format (to be implemented by specific processors if needed)
   * @protected
   * @param {Buffer} data - Data to validate
   * @param {Object} options - Validation options
   * @throws {Error} if validation fails
   */
  validateDataFormat(data, options = {}) {
    // This is a placeholder method that can be overridden by subclasses
    // Default implementation does nothing
  }

  /**
   * Log processing timing information
   * @protected
   * @param {string} operation - Operation name
   * @param {Function} fn - Function to time
   * @returns {Promise<any>} - Result of the function
   */
  async timeOperation(operation, fn) {
    const startTime = Date.now();
    try {
      console.log(`[Processor] Starting operation: ${operation}`);
      const result = await fn();
      const duration = Date.now() - startTime;
      console.log(
        `[Processor] Completed operation: ${operation} in ${duration}ms`
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[Processor] Failed operation: ${operation} after ${duration}ms`
      );
      console.error(`[Processor] Error in ${operation}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle common processing errors
   * @protected
   * @param {Error} error - The error to handle
   * @param {string} operation - The operation that failed
   * @param {Object} context - Additional context
   * @throws {Error} Enhanced error with context
   */
  handleProcessingError(error, operation, context = {}) {
    // Create a more informative error
    const layerType = context.layerType || "unknown";
    const enhancedMessage = `Error processing ${layerType} data in ${operation}: ${error.message}`;

    // Log detailed error information
    console.error(`[Processor] ${enhancedMessage}`);

    if (context.options) {
      console.error(
        "[Processor] Processing options:",
        JSON.stringify(context.options, null, 2)
      );
    }

    if (error.stack) {
      console.error("[Processor] Error stack:", error.stack);
    }

    // Throw enhanced error
    const enhancedError = new Error(enhancedMessage);
    enhancedError.originalError = error;
    enhancedError.context = context;
    throw enhancedError;
  }

  /**
   * Check if processed data has expected properties
   * @protected
   * @param {Object} data - Processed data to validate
   * @param {Array<string>} requiredProps - Required property names
   * @throws {Error} if any required property is missing
   */
  validateProcessedData(data, requiredProps = []) {
    if (!data) {
      throw new Error("Processed data is undefined or null");
    }

    for (const prop of requiredProps) {
      if (data[prop] === undefined) {
        throw new Error(`Processed data is missing required property: ${prop}`);
      }
    }
  }

  /**
   * Create a standardized result object for processed data
   * @protected
   * @param {Object} data - Processed data
   * @param {string} layerType - Layer type
   * @param {Object} metadata - Additional metadata
   * @returns {Object} - Standardized result object
   */
  createProcessedResult(data, layerType, metadata = {}) {
    return {
      layerType,
      data,
      metadata,
      processingTime: new Date().toISOString(),
      processorName: this.constructor.name,
    };
  }
}

module.exports = Processor;
