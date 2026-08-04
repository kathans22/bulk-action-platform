require('dotenv').config();

const express = require('express');
const bulkActionsRoutes = require('./routes/bulkActions.routes');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/bulk-actions', bulkActionsRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
