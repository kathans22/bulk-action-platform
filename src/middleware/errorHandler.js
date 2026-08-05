function routeNotFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;

  if (statusCode === 500) {
    console.error(error.stack);
  }

  res.status(statusCode).json(error.responseBody || { error: error.message });
}

module.exports = { routeNotFound, errorHandler };
