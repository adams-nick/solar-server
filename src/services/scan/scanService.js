// In a production app, you'd use a database to store jobs
// For the MVP, we'll use an in-memory store
const scanJobs = new Map();

// Mock processing stages
const STAGES = [
  "building_data_retrieval",
  "lidar_data_retrieval",
  "model_generation",
  "roof_analysis",
  "solar_potential_calculation",
  "quote_generation",
  "completed",
];

// Create a new scan job
exports.createScanJob = async (buildingId, location, clientId) => {
  // Generate a unique job ID
  const jobId = `scan_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  // Create job object
  const job = {
    id: jobId,
    buildingId,
    location,
    clientId,
    status: "building_data_retrieval",
    progress: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    results: null,
    error: null,
  };

  // Store job
  scanJobs.set(jobId, job);

  // Start processing in the background
  // In a real app, you'd use a job queue like Bull
  this.processScanJobAsync(jobId);

  return job;
};

// Get job status
exports.getScanJobStatus = async (jobId) => {
  const job = scanJobs.get(jobId);

  if (!job) return null;

  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
  };
};

// Get job results
exports.getScanJobResults = async (jobId) => {
  const job = scanJobs.get(jobId);

  if (!job) return null;

  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    results: job.results,
    error: job.error,
  };
};

// Process scan job (async mock implementation)
exports.processScanJobAsync = async (jobId) => {
  const job = scanJobs.get(jobId);

  if (!job) return;

  // Process each stage
  try {
    // Building data retrieval
    await this.updateJobStatus(jobId, "building_data_retrieval", 10);
    await simulateProcessing(1000); // Simulate API call delay

    // LiDAR data retrieval
    await this.updateJobStatus(jobId, "lidar_data_retrieval", 20);
    await simulateProcessing(2000); // Simulate longer processing

    // 3D model generation
    await this.updateJobStatus(jobId, "model_generation", 40);
    await simulateProcessing(3000);

    // Roof analysis
    await this.updateJobStatus(jobId, "roof_analysis", 60);
    await simulateProcessing(1500);

    // Solar potential calculation
    await this.updateJobStatus(jobId, "solar_potential_calculation", 80);
    await simulateProcessing(1500);

    // Quote generation
    await this.updateJobStatus(jobId, "quote_generation", 90);
    await simulateProcessing(1000);

    // Complete
    const mockResults = {
      buildingModel: {
        footprint: {
          /* mock footprint data */
        },
        roofFaces: [
          {
            id: 1,
            area: 120,
            orientation: "south",
            pitch: 30,
            suitability: 0.9,
          },
          {
            id: 2,
            area: 80,
            orientation: "north",
            pitch: 30,
            suitability: 0.3,
          },
        ],
      },
      solarPotential: {
        annualProduction: 12000, // kWh
        installableCapacity: 8.4, // kW
        savingsEstimate: 1800, // $
      },
      quote: {
        installationCost: 16800,
        paybackPeriod: 9.3, // years
      },
    };

    await this.updateJobStatus(jobId, "completed", 100, mockResults);
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    const job = scanJobs.get(jobId);
    if (job) {
      job.error = error.message;
      job.updatedAt = new Date();
      scanJobs.set(jobId, job);
    }
  }
};

// Update job status
exports.updateJobStatus = async (jobId, status, progress, results = null) => {
  const job = scanJobs.get(jobId);

  if (!job) return;

  job.status = status;
  job.progress = progress;
  if (results) job.results = results;
  job.updatedAt = new Date();

  scanJobs.set(jobId, job);
  return job;
};

// Helper function to simulate processing time
function simulateProcessing(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
