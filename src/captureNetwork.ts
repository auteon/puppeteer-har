import { harFromMessages } from "chrome-har"
import { Page } from "puppeteer"
import { Har } from "har-format"
import { observeEvents } from "./observeEvents"
import { captureResponses } from "./captureResponses"

const pageEventsToObserve = [
  "Page.loadEventFired",
  "Page.domContentEventFired",
  "Page.frameStartedLoading",
  "Page.frameAttached",
  "Page.frameScheduledNavigation",
]

const networkEventsToObserve = [
  "Network.requestWillBeSent",
  "Network.requestServedFromCache",
  "Network.dataReceived",
  "Network.responseReceived",
  "Network.resourceChangedPriority",
  "Network.loadingFinished",
  "Network.loadingFailed",
]

type CaptureOptions = {
  saveResponses?: boolean
  captureMimeTypes?: string[]
}

type StopFn = () => Promise<Har>

export async function captureNetwork(
  page: Page,
  {
    saveResponses = false,
    captureMimeTypes = ["text/html", "application/json"],
  }: CaptureOptions = {}
): Promise<StopFn> {
  const client = await page.target().createCDPSession()

  await client.send("Page.enable")
  await client.send("Network.enable")

  const stopPageEventCapturing = observeEvents(client, pageEventsToObserve)
  const stopNetworkEventCapturing = observeEvents(
    client,
    networkEventsToObserve
  )
  const stopRequestCapturing = captureResponses(client, {
    captureMimeTypes,
    saveResponses,
  })

  return async function getHar(): Promise<Har> {
    const pageEvents = await stopPageEventCapturing()
    const networkEvents = await stopRequestCapturing(
      await stopNetworkEventCapturing()
    )

    await client.detach()

    return harFromMessages([...pageEvents, ...networkEvents], {
      includeTextFromResponseBody: saveResponses,
    })
  }
}
