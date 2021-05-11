import { CDPSession, ResponseForRequest } from "puppeteer"

type Params = {
  requestId?: string
  response?: ResponseForRequest
}

export type ObserverResult = {
  method: string
  params: Params
}

export const observeEvents = (
  client: CDPSession,
  events: string[]
): (() => Promise<ObserverResult[]>) => {
  const results: ObserverResult[] = []

  const observers = events.map((method) => {
    const callback = async (params: Params) => results.push({ method, params })

    client.on(method, callback)

    return () => client.off(method, callback)
  })

  const dispose = () => observers.forEach((stopObserving) => stopObserving())

  return async () => {
    dispose()

    return results
  }
}
