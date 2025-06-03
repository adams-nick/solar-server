// src/services/r2TrainingService.js
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

/**
 * R2 Training Data Service
 * Handles saving training data to Cloudflare R2 bucket
 *
 * Required Environment Variables:
 * - R2_ENDPOINT: Your R2 endpoint URL (e.g., https://your-account-id.r2.cloudflarestorage.com)
 * - R2_ACCESS_KEY_ID: Your R2 access key ID
 * - R2_SECRET_ACCESS_KEY: Your R2 secret access key
 * - R2_BUCKET_NAME: Your R2 bucket name (defaults to 'solar-training-data')
 */
class R2TrainingService {
  constructor() {
    // Initialize R2 client
    this.r2Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT, // e.g., https://your-account-id.r2.cloudflarestorage.com
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    this.bucketName = process.env.R2_BUCKET_NAME || "solar-training-data";
  }

  /**
   * Generate file path for training data
   * Format: training-data/YYYY/MM/DD/training_timestamp_random.json
   * @param {string} createdAt - ISO timestamp
   * @returns {string} - File path
   */
  generateFilePath(createdAt) {
    const date = new Date(createdAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    return `training-data/${year}/${month}/${day}/training_${timestamp}_${random}.json`;
  }

  /**
   * Validate training data object before saving
   * @param {Object} trainingData - Training data object
   * @returns {Object} - { isValid: boolean, error?: string }
   */
  validateTrainingData(trainingData) {
    const requiredFields = [
      "rgb_image",
      "prompts",
      "segments",
      "quality_score",
      "created_at",
      "location",
    ];

    for (const field of requiredFields) {
      if (!(field in trainingData)) {
        return {
          isValid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    // Check data types
    if (!Array.isArray(trainingData.prompts)) {
      return { isValid: false, error: "prompts must be an array" };
    }

    if (!Array.isArray(trainingData.segments)) {
      return { isValid: false, error: "segments must be an array" };
    }

    if (typeof trainingData.quality_score !== "number") {
      return { isValid: false, error: "quality_score must be a number" };
    }

    return { isValid: true };
  }

  /**
   * Save training data to R2 bucket
   * @param {Object} trainingData - Training data object
   * @returns {Promise<Object>} - { success: boolean, filePath?: string, error?: string }
   */
  async saveTrainingData(trainingData) {
    try {
      console.log("R2 Service: Starting to save training data");

      // Validate training data
      const validation = this.validateTrainingData(trainingData);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Validation failed: ${validation.error}`,
        };
      }

      // Generate file path
      const filePath = this.generateFilePath(trainingData.created_at);
      console.log(`R2 Service: Generated file path: ${filePath}`);

      // Prepare data for storage
      const dataToStore = {
        ...trainingData,
        // Add storage metadata
        storage_metadata: {
          version: "1.0",
          stored_at: new Date().toISOString(),
          file_path: filePath,
        },
      };

      // Convert to JSON string
      const jsonData = JSON.stringify(dataToStore, null, 2);

      // Create put object command
      const putCommand = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: filePath,
        Body: jsonData,
        ContentType: "application/json",
        Metadata: {
          "quality-score": trainingData.quality_score.toString(),
          "segment-count": trainingData.segments.length.toString(),
          "prompt-count": trainingData.prompts.length.toString(),
          "created-at": trainingData.created_at,
        },
      });

      // Upload to R2
      console.log(`R2 Service: Uploading to bucket: ${this.bucketName}`);
      const response = await this.r2Client.send(putCommand);

      console.log("R2 Service: Upload successful");
      console.log("R2 Response:", {
        ETag: response.ETag,
        filePath: filePath,
        dataSize: jsonData.length,
      });

      return {
        success: true,
        filePath: filePath,
        metadata: {
          size: jsonData.length,
          etag: response.ETag,
          quality_score: trainingData.quality_score,
          segment_count: trainingData.segments.length,
          prompt_count: trainingData.prompts.length,
        },
      };
    } catch (error) {
      console.error("R2 Service: Error saving training data:", error);

      return {
        success: false,
        error: error.message,
        errorCode: error.name || "UnknownError",
      };
    }
  }

  /**
   * Test R2 connection
   * @returns {Promise<Object>} - { success: boolean, error?: string }
   */
  async testConnection() {
    try {
      // Try to list bucket (just to test connection)
      const { ListObjectsV2Command } = require("@aws-sdk/client-s3");

      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        MaxKeys: 1,
      });

      await this.r2Client.send(listCommand);

      return { success: true };
    } catch (error) {
      console.error("R2 Service: Connection test failed:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get training data statistics from R2
   * @returns {Promise<Object>} - Basic stats about stored training data
   */
  async getTrainingDataStats() {
    try {
      const { ListObjectsV2Command } = require("@aws-sdk/client-s3");

      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: "training-data/",
        MaxKeys: 1000, // Adjust as needed
      });

      const response = await this.r2Client.send(listCommand);

      const totalFiles = response.KeyCount || 0;
      const totalSize =
        response.Contents?.reduce((sum, obj) => sum + (obj.Size || 0), 0) || 0;

      return {
        success: true,
        stats: {
          totalFiles,
          totalSizeBytes: totalSize,
          totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
          lastModified: response.Contents?.[0]?.LastModified || null,
        },
      };
    } catch (error) {
      console.error("R2 Service: Error getting stats:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Create singleton instance
const r2TrainingService = new R2TrainingService();

// Export the service functions
module.exports = {
  /**
   * Save training data to R2
   * @param {Object} trainingData - Training data object
   * @returns {Promise<Object>} - Result object
   */
  saveTrainingData: async (trainingData) => {
    return await r2TrainingService.saveTrainingData(trainingData);
  },

  /**
   * Test R2 connection
   * @returns {Promise<Object>} - Connection test result
   */
  testR2Connection: async () => {
    return await r2TrainingService.testConnection();
  },

  /**
   * Get training data statistics
   * @returns {Promise<Object>} - Statistics about stored data
   */
  getTrainingDataStats: async () => {
    return await r2TrainingService.getTrainingDataStats();
  },
};
