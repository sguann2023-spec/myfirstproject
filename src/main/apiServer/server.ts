import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'

import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { API_SERVER_DEFAULTS } from '@shared/config/constant'

import { windowService } from '../services/WindowService'
import { app } from './app'
import { config } from './config'

const logger = loggerService.withContext('ApiServer')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000

export class ApiServer {
  private server: ReturnType<typeof createServer> | null = null
  private listeningPort: number | null = null

  async start(): Promise<void> {
    if (this.server && this.server.listening) {
      logger.warn('Server already running')
      return
    }

    // Clean up any failed server instance
    if (this.server && !this.server.listening) {
      logger.warn('Cleaning up failed server instance')
      this.server = null
    }

    // Load config
    const { port, host } = await config.load()
    const resolvedPort = await this.findAvailablePort(host, port, API_SERVER_DEFAULTS.MAX_PORT)

    // Create server with Express app
    this.server = createServer(app)
    this.applyServerTimeouts(this.server)

    // Start server
    return new Promise((resolve, reject) => {
      this.server!.listen(resolvedPort, host, () => {
        this.listeningPort = resolvedPort
        logger.info('API server started', {
          host,
          preferredPort: port,
          port: resolvedPort
        })

        // Notify renderer that API server is ready
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannel.ApiServer_Ready)
        }

        resolve()
      })

      this.server!.on('error', (error) => {
        // Clean up the server instance if listen fails
        this.server = null
        this.listeningPort = null
        reject(error)
      })
    })
  }

  private async isPortAvailable(host: string, port: number): Promise<boolean> {
    return await new Promise((resolve) => {
      const probe = createNetServer()

      probe.once('error', () => {
        resolve(false)
      })

      probe.once('listening', () => {
        probe.close(() => resolve(true))
      })

      probe.listen(port, host)
    })
  }

  private async findAvailablePort(host: string, preferredPort: number, maxPort: number): Promise<number> {
    for (let port = preferredPort; port <= maxPort; port += 1) {
      // Probe ports in order so we keep 18845 as the first choice.
      if (await this.isPortAvailable(host, port)) {
        return port
      }
    }

    throw new Error(`No available API server port found in range ${preferredPort}-${maxPort}`)
  }

  private applyServerTimeouts(server: ReturnType<typeof createServer>): void {
    server.requestTimeout = GLOBAL_REQUEST_TIMEOUT_MS
    server.headersTimeout = Math.max(GLOBAL_HEADERS_TIMEOUT_MS, server.requestTimeout + 1_000)
    server.keepAliveTimeout = GLOBAL_KEEPALIVE_TIMEOUT_MS
    server.setTimeout(0)
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('API server stopped')
        this.server = null
        this.listeningPort = null
        resolve()
      })
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await config.reload()
    await this.start()
  }

  isRunning(): boolean {
    const hasServer = this.server !== null
    const isListening = this.server?.listening || false
    const result = hasServer && isListening

    logger.debug('isRunning check', { hasServer, isListening, result })

    return result
  }

  getListeningPort(): number | null {
    return this.server?.listening ? this.listeningPort : null
  }
}

export const apiServer = new ApiServer()
