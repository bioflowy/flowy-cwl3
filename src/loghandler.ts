import { createLogger, format, transports } from 'winston';
export const _logger = createLogger({
  level: 'debug', // Set the minimum log level to 'info'
  format: format.combine(format.simple()),
  transports: [new transports.Console({ stderrLevels: ['error', 'warn', 'info', 'debug'] })],
});

// TODO
// function configureLogging(stderrHandler: logging.Handler, quiet: boolean, debug: boolean, enableColor: boolean, timestamps: boolean, baseLogger: logging.Logger = _logger) {
//     let rdflibLogger = logging.getLogger("rdflib.term");
//     rdflibLogger.addHandler(stderrHandler);
//     rdflibLogger.setLevel(logging.ERROR);
//     if (quiet) {
//         stderrHandler.setLevel(logging.WARN);
//     }
//     if (debug) {
//         baseLogger.setLevel(logging.DEBUG);
//         stderrHandler.setLevel(logging.DEBUG);
//         rdflibLogger.setLevel(logging.DEBUG);
//     }
//     let fmtclass = enableColor ? coloredlogs.ColoredFormatter : logging.Formatter;
//     let formatter = new fmtclass("%(levelname)s %(message)s");
//     if (timestamps) {
//         formatter = new fmtclass("[%(asctime)s] %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S");
//     }
//     stderrHandler.setFormatter(formatter);
// }
