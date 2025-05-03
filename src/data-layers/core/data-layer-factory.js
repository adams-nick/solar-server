/**
 * DataLayerFactory for SolarScanner data-layers module
 *
 * This factory manages fetchers, processors, and visualizers for different layer types,
 * implementing the factory pattern to create the appropriate components based on the layer type.
 */

/**
 * Factory for creating appropriate fetcher, processor, and visualizer instances
 */
class DataLayerFactory {
  /**
   * Constructor for the DataLayerFactory
   */
  constructor() {
    // Initialize collections for components
    this.fetchers = [];
    this.processors = [];
    this.visualizers = [];

    // Define supported layer types
    this.supportedLayerTypes = [
      "mask", // Building mask layer
      "dsm", // Digital Surface Model layer
      "rgb", // RGB aerial imagery layer
      "annualFlux", // Annual solar flux layer
      "monthlyFlux", // Monthly solar flux layer
      "hourlyShade", // Hourly shade layer
    ];

    console.log(
      `[DataLayerFactory] Created with supported layer types: ${this.supportedLayerTypes.join(
        ", "
      )}`
    );
  }

  /**
   * Register a fetcher
   * @param {Fetcher} fetcher - The fetcher to register
   * @throws {Error} if fetcher is invalid
   */
  registerFetcher(fetcher) {
    try {
      if (!fetcher) {
        throw new Error("Fetcher must be provided");
      }

      if (typeof fetcher.canHandle !== "function") {
        throw new Error("Fetcher must implement canHandle() method");
      }

      if (typeof fetcher.fetch !== "function") {
        throw new Error("Fetcher must implement fetch() method");
      }

      // Check for duplicate fetchers
      const handledTypes = this.supportedLayerTypes.filter((type) =>
        fetcher.canHandle(type)
      );

      for (const type of handledTypes) {
        if (this.fetchers.some((f) => f.canHandle(type))) {
          console.warn(
            `[DataLayerFactory] Warning: Registering duplicate fetcher for layer type: ${type}`
          );
        }
      }

      // Add to fetchers collection
      this.fetchers.push(fetcher);
      console.log(
        `[DataLayerFactory] Registered fetcher: ${
          fetcher.constructor.name
        } for layer types: ${handledTypes.join(", ")}`
      );
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error registering fetcher: ${error.message}`
      );
      throw new Error(`Failed to register fetcher: ${error.message}`);
    }
  }

  /**
   * Register a processor
   * @param {Processor} processor - The processor to register
   * @throws {Error} if processor is invalid
   */
  registerProcessor(processor) {
    try {
      if (!processor) {
        throw new Error("Processor must be provided");
      }

      if (typeof processor.canHandle !== "function") {
        throw new Error("Processor must implement canHandle() method");
      }

      if (typeof processor.process !== "function") {
        throw new Error("Processor must implement process() method");
      }

      // Check for duplicate processors
      const handledTypes = this.supportedLayerTypes.filter((type) =>
        processor.canHandle(type)
      );

      for (const type of handledTypes) {
        if (this.processors.some((p) => p.canHandle(type))) {
          console.warn(
            `[DataLayerFactory] Warning: Registering duplicate processor for layer type: ${type}`
          );
        }
      }

      // Add to processors collection
      this.processors.push(processor);
      console.log(
        `[DataLayerFactory] Registered processor: ${
          processor.constructor.name
        } for layer types: ${handledTypes.join(", ")}`
      );
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error registering processor: ${error.message}`
      );
      throw new Error(`Failed to register processor: ${error.message}`);
    }
  }

  /**
   * Register a visualizer
   * @param {Visualizer} visualizer - The visualizer to register
   * @throws {Error} if visualizer is invalid
   */
  registerVisualizer(visualizer) {
    try {
      if (!visualizer) {
        throw new Error("Visualizer must be provided");
      }

      if (typeof visualizer.canHandle !== "function") {
        throw new Error("Visualizer must implement canHandle() method");
      }

      if (typeof visualizer.visualize !== "function") {
        throw new Error("Visualizer must implement visualize() method");
      }

      // Check for duplicate visualizers
      const handledTypes = this.supportedLayerTypes.filter((type) =>
        visualizer.canHandle(type)
      );

      for (const type of handledTypes) {
        if (this.visualizers.some((v) => v.canHandle(type))) {
          console.warn(
            `[DataLayerFactory] Warning: Registering duplicate visualizer for layer type: ${type}`
          );
        }
      }

      // Add to visualizers collection
      this.visualizers.push(visualizer);
      console.log(
        `[DataLayerFactory] Registered visualizer: ${
          visualizer.constructor.name
        } for layer types: ${handledTypes.join(", ")}`
      );
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error registering visualizer: ${error.message}`
      );
      throw new Error(`Failed to register visualizer: ${error.message}`);
    }
  }

  /**
   * Get the appropriate fetcher for a layer type
   * @param {string} layerType - The layer type
   * @returns {Fetcher} - The fetcher
   * @throws {Error} if no suitable fetcher is found
   */
  getFetcher(layerType) {
    try {
      this.validateLayerType(layerType);

      const fetcher = this.fetchers.find((f) => f.canHandle(layerType));

      if (!fetcher) {
        throw new Error(`No fetcher available for layer type: ${layerType}`);
      }

      console.log(
        `[DataLayerFactory] Found fetcher: ${fetcher.constructor.name} for layer type: ${layerType}`
      );
      return fetcher;
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error getting fetcher: ${error.message}`
      );
      throw new Error(
        `Failed to get fetcher for layer type '${layerType}': ${error.message}`
      );
    }
  }

  /**
   * Get the appropriate processor for a layer type
   * @param {string} layerType - The layer type
   * @returns {Processor} - The processor
   * @throws {Error} if no suitable processor is found
   */
  getProcessor(layerType) {
    try {
      this.validateLayerType(layerType);

      const processor = this.processors.find((p) => p.canHandle(layerType));

      if (!processor) {
        throw new Error(`No processor available for layer type: ${layerType}`);
      }

      console.log(
        `[DataLayerFactory] Found processor: ${processor.constructor.name} for layer type: ${layerType}`
      );
      return processor;
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error getting processor: ${error.message}`
      );
      throw new Error(
        `Failed to get processor for layer type '${layerType}': ${error.message}`
      );
    }
  }

  /**
   * Get the appropriate visualizer for a layer type
   * @param {string} layerType - The layer type
   * @returns {Visualizer} - The visualizer
   * @throws {Error} if no suitable visualizer is found
   */
  getVisualizer(layerType) {
    try {
      this.validateLayerType(layerType);

      const visualizer = this.visualizers.find((v) => v.canHandle(layerType));

      if (!visualizer) {
        throw new Error(`No visualizer available for layer type: ${layerType}`);
      }

      console.log(
        `[DataLayerFactory] Found visualizer: ${visualizer.constructor.name} for layer type: ${layerType}`
      );
      return visualizer;
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error getting visualizer: ${error.message}`
      );
      throw new Error(
        `Failed to get visualizer for layer type '${layerType}': ${error.message}`
      );
    }
  }

  /**
   * Check if a layer type is supported
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if the layer type is supported
   */
  supportsLayerType(layerType) {
    return this.supportedLayerTypes.includes(layerType);
  }

  /**
   * Get all supported layer types
   * @returns {Array<string>} - Array of supported layer types
   */
  getSupportedLayerTypes() {
    return [...this.supportedLayerTypes];
  }

  /**
   * Validate a layer type
   * @private
   * @param {string} layerType - The layer type to validate
   * @throws {Error} if layer type is invalid
   */
  validateLayerType(layerType) {
    if (!layerType) {
      throw new Error("Layer type must be provided");
    }

    if (typeof layerType !== "string") {
      throw new Error("Layer type must be a string");
    }

    if (!this.supportsLayerType(layerType)) {
      throw new Error(
        `Unsupported layer type: ${layerType}. Supported types are: ${this.supportedLayerTypes.join(
          ", "
        )}`
      );
    }
  }

  /**
   * Get all registered components for a specific layer type
   * @param {string} layerType - The layer type
   * @returns {Object} - Object containing fetcher, processor, and visualizer for the layer type
   * @throws {Error} if any component is missing
   */
  getComponentsForLayerType(layerType) {
    try {
      const fetcher = this.getFetcher(layerType);
      const processor = this.getProcessor(layerType);
      const visualizer = this.getVisualizer(layerType);

      return {
        fetcher,
        processor,
        visualizer,
        layerType,
      };
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error getting components for layer type '${layerType}': ${error.message}`
      );
      throw new Error(
        `Failed to get all components for layer type '${layerType}': ${error.message}`
      );
    }
  }

  /**
   * Check if all required components are registered for a layer type
   * @param {string} layerType - The layer type to check
   * @returns {boolean} - True if all components are available
   */
  hasAllComponents(layerType) {
    try {
      if (!this.supportsLayerType(layerType)) {
        return false;
      }

      const hasFetcher = this.fetchers.some((f) => f.canHandle(layerType));
      const hasProcessor = this.processors.some((p) => p.canHandle(layerType));
      const hasVisualizer = this.visualizers.some((v) =>
        v.canHandle(layerType)
      );

      return hasFetcher && hasProcessor && hasVisualizer;
    } catch (error) {
      console.error(
        `[DataLayerFactory] Error checking components: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Get all supported layer types that have complete implementation
   * (fetcher, processor, and visualizer)
   * @returns {Array<string>} - Array of fully implemented layer types
   */
  getFullyImplementedLayerTypes() {
    return this.supportedLayerTypes.filter((type) =>
      this.hasAllComponents(type)
    );
  }
}

module.exports = DataLayerFactory;
