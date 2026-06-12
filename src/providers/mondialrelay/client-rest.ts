import type { Logger } from "@medusajs/framework/types"
import {
	Address,
	MondialRelayOptions,
	Parcel,
	ShipmentCreationRequest,
} from "../../types/index.js"

class MondialRelayClientRest {
	apiBaseUrl: string
	login: string
	password: string
	customerId: string
	culture: string
	versionAPI: string = "1.0"
	businessAddress: Address
	logger: Logger

	constructor(options: MondialRelayOptions, logger: Logger) {
		this.apiBaseUrl =
			options.apiBaseUrl ?? "https://connect-api.mondialrelay.com/api/Shipment"
		this.login = options.login as string
		this.password = options.password as string
		this.customerId = options.customerId as string
		this.culture = options.culture ?? "fr-FR"
		this.businessAddress = options.businessAddress as Address
		this.logger = logger
	}

	/**
	 * Header Authorization en Basic Auth (login:password en base64)
	 * Le login fourni par MR v2 est au format "xxx@business-api.mondialrelay.com"
	 */
	private getAuthHeader(): string {
		const credentials = Buffer.from(`${this.login}:${this.password}`).toString("base64")
		return `Basic ${credentials}`
	}

	private async sendRequest(body: Record<string, unknown>): Promise<any> {
		this.logger.info(`[Mondial Relay] POST ${this.apiBaseUrl}`)
		this.logger.info(`[Mondial Relay] Body: ${JSON.stringify(body)}`)

		const response = await fetch(this.apiBaseUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: this.getAuthHeader(),
			},
			body: JSON.stringify(body),
		})

		const responseText = await response.text()
		this.logger.info(`[Mondial Relay] Response status: ${response.status}`)
		this.logger.info(`[Mondial Relay] Response body: ${responseText}`)

		if (!response.ok) {
			throw new Error(
				`Mondial Relay API error ${response.status}: ${responseText}`
			)
		}

		let result: any
		try {
			result = JSON.parse(responseText)
		} catch {
			throw new Error(
				`Mondial Relay returned invalid JSON: ${responseText}`
			)
		}

		this.handleErrors(result)
		return result
	}

	private handleErrors(result: any): void {
		const statusList =
			result?.statusListField ??
			result?.ShipmentCreationResponse?.StatusList?.Status ??
			result?.StatusList?.Status ??
			[]

		for (const status of statusList) {
			const code = status?.codeField ?? status?.Code ?? status?.$?.Code
			const level = status?.levelField ?? status?.Level ?? status?.$?.Level
			const message = status?.messageField ?? status?.Message ?? status?.$?.Message

			if (level === "Error") {
				this.logger.error(`[Mondial Relay] Error ${code}: ${message}`)
				throw new Error(`Mondial Relay API Error [${code}]: ${message}`)
			}

			this.logger.warn(`[Mondial Relay] Warning ${code}: ${message}`)
		}
	}

	private buildBody(data: ShipmentCreationRequest): Record<string, unknown> {
		const { context, outputOptions, shipmentsList } = data

		return {
			Context: {
				Login: context.login,
				Password: context.password,
				CustomerId: context.customerId,
				Culture: context.culture,
				VersionAPI: context.versionAPI ?? "1.0",
			},
			OutputOptions: {
				OutputFormat: outputOptions.outputFormat ?? "A4",
				OutputType: outputOptions.outputType ?? "PdfUrl",
			},
			ShipmentsList: {
				Shipment: shipmentsList.map((shipment) => ({
					OrderNo: shipment.orderNo,
					CustomerNo: shipment.customerNo,
					ParcelCount: shipment.parcelCount,
					DeliveryMode: {
						Mode: shipment.deliveryMode.mode,
						Location: shipment.deliveryMode.location,
					},
					CollectionMode: {
						Mode: shipment.collectionMode.mode,
						Location: shipment.collectionMode.location,
					},
					Parcels: {
						Parcel: shipment.parcels.map((parcel: Parcel) => ({
							Content: parcel.content,
							Weight: {
								Value: parcel.weight.value,
								Unit: parcel.weight.unit,
							},
						})),
					},
					DeliveryInstruction: shipment.deliveryInstruction ?? "",
					Sender: this.buildAddress(shipment.sender),
					Recipient: this.buildAddress(shipment.recipient),
				})),
			},
		}
	}

	private buildAddress(address: Address): Record<string, unknown> {
		return {
			Title: address?.title ?? "",
			Firstname: address?.firstname ?? "",
			Lastname: address?.lastname ?? "",
			Streetname: address?.streetname ?? "",
			AddressAdd1: address?.addressAdd1 ?? "",
			AddressAdd2: address?.addressAdd2 ?? "",
			CountryCode: address?.countryCode?.toUpperCase() ?? "",
			PostCode: address?.postCode ?? "",
			City: address?.city ?? "",
			MobileNo: address?.mobileNo ?? "",
			Email: address?.email ?? "",
		}
	}

	async createShipment(data: ShipmentCreationRequest): Promise<{
		shipment_number: string
		shipment_label: string
		shippement_raw_content: Record<string, unknown>
	}> {
		try {
			const body = this.buildBody(data)
			const result = await this.sendRequest(body)

			// L'API v2 REST retourne les mêmes champs que le SOAP, mais en JSON
			const shipmentData =
				result?.shipmentsListField?.[0] ??
				result?.ShipmentCreationResponse?.ShipmentsList?.Shipment?.[0] ??
				result?.ShipmentsList?.Shipment?.[0]

			if (!shipmentData) {
				throw new Error(
					"Mondial Relay: aucun shipment dans la réponse"
				)
			}

			const shipmentNumber =
				shipmentData?.ShipmentNumber ??
				shipmentData?.$?.ShipmentNumber

			const shipmentLabel =
				shipmentData?.LabelList?.Label?.[0]?.Output ??
				shipmentData?.LabelList?.Label?.[0]?.Output?.[0]

			const rawContent =
				shipmentData?.LabelList?.Label?.[0]?.RawContent ?? null

			this.logger.info(
				`[Mondial Relay] Shipment créé - numéro: ${shipmentNumber}`
			)
			this.logger.info(
				`[Mondial Relay] Label URL: ${shipmentLabel}`
			)

			return {
				shipment_number: shipmentNumber,
				shipment_label: shipmentLabel,
				shippement_raw_content: rawContent,
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error)
			this.logger.error(
				`[Mondial Relay] Échec création shipment: ${errorMessage}`
			)
			throw error
		}
	}
}

export default MondialRelayClientRest