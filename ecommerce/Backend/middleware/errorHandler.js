const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    
    const statusCode = err.statusCode || 500;
    
    res.status(statusCode).json({
      error: {
        message: err.message || 'Une erreur interne s\'est produite',
        status: statusCode
      }
    });
  };
  
  module.exports = errorHandler;