import { CDPSession } from "puppeteer"
import { ObserverResult } from "./observeEvents"

type CaptureResponsesOptions = {
  captureMimeTypes: string[]
  saveResponses: boolean
}

export const captureResponses = (
  client: CDPSession,
  { captureMimeTypes, saveResponses }: CaptureResponsesOptions
): ((networkEvents: ObserverResult[]) => Promise<ObserverResult[]>) => {
  const [createResolvable, getResponses] = resolvableFactory()

  const callback = async (params: any) => {
    if (!saveResponses) {
      return
    }

    const { response, requestId } = params

    // Response body is unavailable for redirects, no-content, image, audio and video responses
    if (
      response.status === 204 ||
      response.headers.location != null ||
      !captureMimeTypes.includes(response.mimeType)
    ) {
      return
    }

    const resolve = createResolvable()

    if (response.mimeType === "text/html") {
      client.on("Network.loadingFinished", async (params) => {
        if (params.requestId !== requestId) {
          return
        }

        resolve({
          [requestId]: await extractResponseContent(client, requestId),
        })
      })
    } else {
      resolve({
        [requestId]: await extractResponseContent(client, requestId),
      })
    }
  }

  client.on("Network.responseReceived", callback)

  const dispose = () => client.off("Network.responseReceived", callback)

  return async (networkEvents: ObserverResult[]) => {
    dispose()

    const responses = await getResponses()

    return networkEvents.map((event) => {
      const { requestId, response } = event.params

      if (!requestId || !response) {
        return event
      }

      const body = responses[requestId]

      if (!body) {
        return event
      }

      return {
        ...event,
        params: {
          ...event.params,
          response: {
            ...response,

            body,
          },
        },
      }
    })
  }
}

const extractResponseContent = async (
  client: CDPSession,
  requestId: string
) => {
  try {
    const responseBody = await client.send("Network.getResponseBody", {
      requestId,
    })

    // Set the response so `chrome-har` can add it to the HAR
    return Buffer.from(
      responseBody.body,
      responseBody.base64Encoded ? "base64" : undefined
    ).toString()
  } catch (e) {
    console.log(e)
    // Resources (i.e. response bodies) are flushed after page commits
    // navigation and we are no longer able to retrieve them. In this
    // case, fail soft so we still add the rest of the response to the
    // HAR. Possible option would be force wait before navigation...
  }
}

type Response = Record<string, string | void>
type ResolverFn = (record: Response) => void

const resolvableFactory = (): [
  createResolvable: () => ResolverFn,
  getResults: () => Promise<Response>
] => {
  const promises: Promise<Response>[] = []

  const createResolvable = () => {
    const resolverRef: { current: null | ResolverFn } = { current: null }

    const promise = new Promise<Response>((resolve) => {
      resolverRef.current = resolve
    })

    const resolver = (response: Response) => {
      if (!resolverRef.current) {
        setTimeout(resolver, 1)
      } else {
        resolverRef.current(response)
      }
    }

    promises.push(promise)

    return resolver
  }

  const getResults = async () => {
    const results = await Promise.all(promises)

    return results.reduce(
      (combinedResults, result) => ({ ...combinedResults, ...result }),
      {}
    )
  }

  return [createResolvable, getResults]
}
