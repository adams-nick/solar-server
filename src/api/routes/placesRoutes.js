// src/api/routes/placesRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
      {
        params: {
          input: query,
          inputtype: "textquery",
          fields: "formatted_address,name,geometry,place_id",
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Error proxying places search:", error);
    res.status(500).json({ error: "Failed to search places" });
  }
});

module.exports = router;
