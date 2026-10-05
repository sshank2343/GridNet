const winston = require('winston')

function createServiceLogger(serviceName){
    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta })=>{
                return JSON.stringify({ timestamp,level, service: serviceName, message, ...meta});
            })
        ),
        transports: [new winston.transports.Console()],
    });
}

module.exports = { createServiceLogger}