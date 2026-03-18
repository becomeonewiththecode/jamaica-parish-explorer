const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Jamaica Parish Explorer API',
      version: '1.0.0',
      description: 'API for exploring Jamaican parishes, places, weather, flights, vessels, and cruise schedules.',
    },
    servers: [
      { url: '/api', description: 'API server' },
    ],
    tags: [
      { name: 'Health', description: 'Server health and provider status' },
      { name: 'Parishes', description: 'Parish data and map rendering' },
      { name: 'Notes', description: 'User notes on parishes' },
      { name: 'Places', description: 'Points of interest across Jamaica' },
      { name: 'Airports', description: 'Jamaican airport data' },
      { name: 'Flights', description: 'Live and scheduled flight data' },
      { name: 'Weather', description: 'Weather conditions and forecasts' },
      { name: 'Vessels', description: 'AIS vessel tracking near Jamaica' },
      { name: 'Cruises', description: 'Cruise ship schedules by port' },
      { name: 'Admin', description: 'Administrative operations' },
    ],
  },
  apis: ['./routes/*.js', './index.js'],
};

const swaggerSpec = swaggerJsdoc(options);

function setup(app) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Jamaica Parish Explorer API Docs',
  }));
  app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
}

module.exports = { setup };
