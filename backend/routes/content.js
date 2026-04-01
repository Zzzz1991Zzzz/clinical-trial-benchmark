const express = require('express');
const { getHomeContent } = require('../services/content');

const router = express.Router();

router.get('/home', async (req, res, next) => {
  try {
    const content = await getHomeContent();
  res.json({
    success: true,
      content
  });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
