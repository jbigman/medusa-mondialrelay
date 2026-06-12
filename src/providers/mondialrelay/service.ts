import {
	AbstractFulfillmentProviderService,
} from "@medusajs/framework/utils"
import type {
	Logger,
	FulfillmentOption,
	CreateFulfillmentResult,
	CalculatedShippingOptionPrice,
} from "@medusajs/framework/types"
import {
	CollectionMode,
	CollectionModemodeEnum,
	DeliveryMode,
	DeliveryModemodeEnum,
	MondialRelayOptions,
	OutputOptions,
} from "../../types/index.js"
import MondialRelayClientSoap from "./client-soap.js"
import { createMondialRelayClient } from "./client.js"
import MondialRelayClientRest from "./client-rest.js"

type InjectedDependencies = {
	logger: Logger
}

class MondialRelayFulfillmentService extends AbstractFulfillmentProviderService {
	static identifier = "mondialrelay"

	private client: MondialRelayClientSoap | MondialRelayClientRest
	protected readonly config_: MondialRelayOptions
	protected readonly logger_: Logger

	constructor(
		{ logger }: InjectedDependencies,
		options: MondialRelayOptions
	) {
		super()
		this.config_ = options
		this.logger_ = logger
		this.client = createMondialRelayClient(options, logger)
	}

	async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
		return [
			{
				id: "mondialrelay-fulfillment",
				name: "Mondial Relay - Point Relais",
			},
			{
				id: "mondialrelay-fulfillment-return",
				name: "Mondial Relay - Retour",
				is_return: true,
			},
		]
	}

	async validateFulfillmentData(
		optionData: Record<string, unknown>,
		data: Record<string, unknown>,
		context: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		return data
	}

	async validateOption(
		data: Record<string, unknown>
	): Promise<boolean> {
		return true
	}

	async canCalculate(
		data: any
	): Promise<boolean> {
		// Enable calculated pricing for Mondial Relay
		this.logger_.info(`[Mondial Relay] canCalculate called with data: ${JSON.stringify(data)}`)
		return true
	}

	async calculatePrice(
		optionData: Record<string, unknown>,
		data: Record<string, unknown>,
		context: Record<string, unknown>
	): Promise<CalculatedShippingOptionPrice> {
		this.logger_.info(`[Mondial Relay] ========== CALCULATE PRICE ==========`)
		this.logger_.info(`[Mondial Relay] optionData: ${JSON.stringify(optionData)}`)
		this.logger_.info(`[Mondial Relay] data: ${JSON.stringify(data)}`)

		// The shipping option name is passed from the frontend via the `data` parameter
		const shippingOptionName = data?.shipping_option_name as string | undefined
		const dataMetadata = data?.metadata as Record<string, unknown> | undefined

		this.logger_.info(`[Mondial Relay] shippingOptionName from frontend: ${shippingOptionName}`)

		// Detect if this is home delivery based on:
		// 1. data.metadata.type === "home" (from frontend)
		// 2. shipping option name containing "domicile"
		const optionType = optionData?.type as string | undefined
		const metadataType = dataMetadata?.type as string | undefined

		const nameContainsDomicile = shippingOptionName?.toLowerCase().includes("domicile") || false

		const isHomeDelivery = optionType === "home" ||
			metadataType === "home" ||
			nameContainsDomicile

		this.logger_.info(`[Mondial Relay] optionType: ${optionType}, metadataType: ${metadataType}, nameContainsDomicile: ${nameContainsDomicile}`)
		this.logger_.info(`[Mondial Relay] isHomeDelivery: ${isHomeDelivery}`)

		// Extract cart items from context to calculate weight
		const items = context?.items as Record<string, unknown>[] | undefined

		this.logger_.info(`[Mondial Relay] items count: ${items?.length ?? 0}`)

		// Calculate total weight from items (in grams)
		let totalWeight = 0
		if (items && Array.isArray(items)) {
			totalWeight = items.reduce((acc, item) => {
				const quantity = (item?.quantity as number) ?? 1
				const variant = item?.variant as Record<string, unknown> | undefined
				const weight = (variant?.weight as number) ?? 500 // default 500g per item
				this.logger_.info(`[Mondial Relay] Item: qty=${quantity}, weight=${weight}g`)
				return acc + quantity * weight
			}, 0)
		}

		// If no items or weight is 0, use default weight
		if (totalWeight === 0) {
			totalWeight = 500 // Default 500g
			this.logger_.info(`[Mondial Relay] No weight found, using default 500g`)
		}

		// Get destination country from shipping address
		const shippingAddress = context?.shipping_address as Record<string, unknown> | undefined
		const countryCode = ((shippingAddress?.country_code as string) ?? "FR").toUpperCase()

		this.logger_.info(`[Mondial Relay] Destination country: ${countryCode}, Weight: ${totalWeight}g`)

		// Use @frontboi/mondial-relay for price calculation
		let priceInEuros: number

		try {
			// Import dynamically to avoid issues with CommonJS/ESM
			const { getDeliveryPrice } = await import("@frontboi/mondial-relay")

			// getDeliveryPrice expects weight in grams first, then country code
			const deliveryPrice = getDeliveryPrice(totalWeight, countryCode as any)

			if (deliveryPrice !== null && deliveryPrice !== undefined) {
				priceInEuros = deliveryPrice
				this.logger_.info(`[Mondial Relay] Price from frontboi: ${priceInEuros}€`)

				// Apply home delivery surcharge (typically +3€)
				if (isHomeDelivery) {
					priceInEuros += 3
					this.logger_.info(`[Mondial Relay] Home delivery surcharge applied: +3€ = ${priceInEuros}€`)
				}
			} else {
				// Fallback to default pricing if frontboi returns null
				this.logger_.warn(`[Mondial Relay] frontboi returned null, using fallback pricing`)
				priceInEuros = this.getFallbackPrice(totalWeight, isHomeDelivery)
			}
		} catch (error) {
			// Fallback to hardcoded pricing if frontboi fails
			this.logger_.warn(`[Mondial Relay] Failed to get price from frontboi: ${error}`)
			priceInEuros = this.getFallbackPrice(totalWeight, isHomeDelivery)
		}

		const deliveryType = isHomeDelivery ? "Home Delivery" : "Point Relais"

		this.logger_.info(
			`[Mondial Relay] Final price: ${priceInEuros}€ for ${totalWeight}g - ${deliveryType}`
		)

		return {
			calculated_amount: priceInEuros,
			is_calculated_price_tax_inclusive: true,
		}
	}

	// Fallback pricing when @frontboi/mondial-relay fails
	private getFallbackPrice(totalWeightGrams: number, isHomeDelivery: boolean): number {
		const weightKg = totalWeightGrams / 1000

		if (isHomeDelivery) {
			// Home Delivery - more expensive
			if (weightKg <= 0.5) return 7.95
			if (weightKg <= 1) return 8.95
			if (weightKg <= 2) return 9.95
			if (weightKg <= 3) return 10.95
			if (weightKg <= 5) return 12.95
			if (weightKg <= 10) return 15.95
			if (weightKg <= 20) return 19.95
			return 24.95
		} else {
			// Point Relais - cheaper
			if (weightKg <= 0.5) return 4.95
			if (weightKg <= 1) return 5.95
			if (weightKg <= 2) return 6.95
			if (weightKg <= 3) return 7.95
			if (weightKg <= 5) return 8.95
			if (weightKg <= 10) return 10.95
			if (weightKg <= 20) return 14.95
			return 19.95
		}
	}

	async createFulfillment(
		data: Record<string, unknown>,
		items: Record<string, unknown>[],
		order: Record<string, unknown> | undefined,
		fulfillment: Record<string, unknown>
	): Promise<CreateFulfillmentResult> {
		this.logger_.info(`[Mondial Relay] ========== CREATE FULFILLMENT ==========`)
		this.logger_.info(`[Mondial Relay] data: ${JSON.stringify(data)}`)
		this.logger_.info(`[Mondial Relay] items count: ${items?.length}`)
		this.logger_.info(`[Mondial Relay] order id: ${order?.id}`)
		this.logger_.info(`[Mondial Relay] fulfillment id: ${fulfillment?.id}`)

		const businessAddress = this.config_.businessAddress

		// Extract shipping option metadata
		const shippingOption = fulfillment?.shipping_option as Record<string, unknown> | undefined
		const metadata = shippingOption?.metadata as Record<string, unknown> | undefined

		const isPrintInStore = metadata?.print === "in_store"
		const isHomeDelivery = metadata?.type === "home"

		this.logger_.info(`[Mondial Relay] isPrintInStore: ${isPrintInStore}, isHomeDelivery: ${isHomeDelivery}`)

		// Extract shipping address from order
		const shippingAddress = order?.shipping_address as Record<string, unknown> | undefined
		const addressMetadata = shippingAddress?.metadata as Record<string, unknown> | undefined
		const isLocker = addressMetadata?.isLocker === true

		this.logger_.info(`[Mondial Relay] shippingAddress: ${JSON.stringify(shippingAddress)}`)

		// Calculate total weight from items
		const totalWeight = items.reduce((acc, item) => {
			const quantity = (item?.quantity as number) ?? 1
			const variant = item?.variant as Record<string, unknown> | undefined
			const weight = (variant?.weight as number) ?? 500
			return acc + quantity * weight
		}, 0)

		this.logger_.info(`[Mondial Relay] totalWeight: ${totalWeight}g`)

		const parcels = [
			{
				content: fulfillment?.id as string,
				weight: {
					value: totalWeight,
					unit: "gr",
				},
			},
		]

		const outputOptions: OutputOptions = isPrintInStore
			? {
				outputType: "QRCode",
				outputFormat: undefined,
			}
			: {
				outputFormat: "A4",
				outputType: "PdfUrl",
			}

		// Extract parcel shop ID from fulfillment data (sent from storefront) or fallback to address_2
		const fulfillmentData = data as Record<string, unknown> | undefined
		this.logger_.info(`[Mondial Relay] ========== PARCEL SHOP ==========`)
		this.logger_.info(`[Mondial Relay] fulfillmentData.parcel_shop_id: ${fulfillmentData?.parcel_shop_id}`)
		this.logger_.info(`[Mondial Relay] shippingAddress.address_2: ${shippingAddress?.address_2}`)

		const rawParcelShopId = (fulfillmentData?.parcel_shop_id as string) ??
			(shippingAddress?.address_2 as string) ?? ""

		// Get country code from shipping address and format parcel shop ID
		// Mondial Relay requires format: "FR-020340" (country code + parcel shop number)
		const countryCode = ((shippingAddress?.country_code as string) ?? "FR").toUpperCase()
		const parcelShopId = rawParcelShopId
			? (rawParcelShopId.includes("-") ? rawParcelShopId : `${countryCode}-${rawParcelShopId}`)
			: ""

		this.logger_.info(`[Mondial Relay] Country code: ${countryCode}`)
		this.logger_.info(`[Mondial Relay] Raw parcelShopId: ${rawParcelShopId}`)
		this.logger_.info(`[Mondial Relay] Final parcelShopId (with prefix): ${parcelShopId}`)

		const deliveryMode: DeliveryMode = isHomeDelivery
			? {
				mode: DeliveryModemodeEnum.HOM,
				location: "",
			}
			: {
				mode: isLocker
					? DeliveryModemodeEnum.LOCKER
					: DeliveryModemodeEnum.PR,
				location: parcelShopId,
			}

		const collectionMode: CollectionMode = {
			mode: CollectionModemodeEnum.REL,
			location: "",
		}
		const rawPhone = (shippingAddress?.phone as string) ?? ""
		const normalizedPhone = rawPhone.startsWith("+33")
			? "0" + rawPhone.slice(3)
			: rawPhone
		const shipmentRequest = {
			context: {
				login: this.client.login,
				password: this.client.password,
				customerId: this.client.customerId,
				culture: this.client.culture,
				versionAPI: this.client.versionAPI,
			},
			outputOptions,
			shipmentsList: [
				{
					orderNo: (order?.display_id?.toString() as string) ?? "",
					customerNo: "",
					parcelCount: 1,
					deliveryMode,
					collectionMode,
					parcels,
					deliveryInstruction: "",
					sender: {
						title: businessAddress?.title ?? "",
						firstname: businessAddress?.firstname ?? "",
						lastname: businessAddress?.lastname ?? "",
						streetname: businessAddress?.streetname ?? "",
						countryCode: businessAddress?.countryCode ?? "",
						postCode: businessAddress?.postCode ?? "",
						city: businessAddress?.city ?? "",
						addressAdd1: businessAddress?.addressAdd1 ?? "",
						addressAdd2: businessAddress?.addressAdd2 ?? "",
						mobileNo: businessAddress?.mobileNo ?? "",
						email: businessAddress?.email ?? "",
					},
					recipient: {
						title: "",
						firstname: (shippingAddress?.first_name as string) ?? "",
						lastname: (shippingAddress?.last_name as string) ?? "",
						streetname: (shippingAddress?.address_1 as string) ?? "",
						addressAdd2: (shippingAddress?.address_2 as string) ?? "",
						countryCode: (shippingAddress?.country_code as string) ?? "",
						postCode: (shippingAddress?.postal_code as string) ?? "",
						city: (shippingAddress?.city as string) ?? "",
						addressAdd1: "",
						mobileNo: normalizedPhone,
						email: (order?.email as string) || (shippingAddress?.email as string) || "contact@annor-atelier.fr",
					},
				},
			],
		}

		const result = await this.client.createShipment(shipmentRequest)

		return {
			data: {
				...((fulfillment?.data as object) || {}),
				...result,
			},
			labels: result.shipment_label ? [
				{
					tracking_number: result.shipment_number,
					tracking_url: "",
					label_url: result.shipment_label,
				}
			] : [],
		}
	}

	async createReturnFulfillment(
		fulfillment: Record<string, unknown>
	): Promise<CreateFulfillmentResult> {
		const businessAddress = this.config_.businessAddress

		// Extract order from fulfillment
		const order = fulfillment?.order as Record<string, unknown> | undefined
		const shippingAddress = order?.shipping_address as Record<string, unknown> | undefined
		const items = fulfillment?.items as Record<string, unknown>[] | undefined

		// Extract shipping option metadata
		const shippingOption = fulfillment?.shipping_option as Record<string, unknown> | undefined
		const metadata = shippingOption?.metadata as Record<string, unknown> | undefined

		const isPrintInStore = metadata?.print === "in_store"
		const isHomeDelivery = metadata?.type === "home"
		const addressMetadata = shippingAddress?.metadata as Record<string, unknown> | undefined
		const isLocker = addressMetadata?.isLocker === true

		// Calculate total weight from items
		const totalWeight = items?.reduce((acc, item) => {
			const quantity = (item?.quantity as number) ?? 1
			const variant = item?.variant as Record<string, unknown> | undefined
			const weight = (variant?.weight as number) ?? 500
			return acc + quantity * weight
		}, 0) ?? 500

		const parcels = [
			{
				content: fulfillment?.id as string,
				weight: {
					value: totalWeight,
					unit: "gr",
				},
			},
		]

		const outputOptions: OutputOptions = isPrintInStore
			? {
				outputType: "QRCode",
				outputFormat: undefined,
			}
			: {
				outputFormat: "A4",
				outputType: "PdfUrl",
			}

		const deliveryMode: DeliveryMode = isHomeDelivery
			? {
				mode: DeliveryModemodeEnum.HOM,
				location: "",
			}
			: {
				mode: isLocker
					? DeliveryModemodeEnum.LOCKER
					: DeliveryModemodeEnum.PR,
				location: businessAddress?.returnLocation ?? "",
			}

		const collectionMode: CollectionMode = {
			mode: CollectionModemodeEnum.REL,
			location: "",
		}

		const shipmentRequest = {
			context: {
				login: this.client.login,
				password: this.client.password,
				customerId: this.client.customerId,
				culture: this.client.culture,
				versionAPI: this.client.versionAPI,
			},
			outputOptions,
			shipmentsList: [
				{
					orderNo: order?.display_id?.toString() ?? "",
					customerNo: "",
					parcelCount: 1,
					deliveryMode,
					collectionMode,
					parcels,
					deliveryInstruction: "",
					// For returns, sender is the customer
					sender: {
						title: "",
						firstname: (shippingAddress?.first_name as string) ?? "",
						lastname: (shippingAddress?.last_name as string) ?? "",
						streetname: (shippingAddress?.address_1 as string) ?? "",
						addressAdd2: (shippingAddress?.address_2 as string) ?? "",
						countryCode: (shippingAddress?.country_code as string) ?? "",
						postCode: (shippingAddress?.postal_code as string) ?? "",
						city: (shippingAddress?.city as string) ?? "",
						addressAdd1: "",
						mobileNo: (shippingAddress?.phone as string) ?? "",
						email: (order?.email as string) ?? "",
					},
					// Recipient is the business
					recipient: {
						title: businessAddress?.title ?? "",
						firstname: businessAddress?.firstname ?? "",
						lastname: businessAddress?.lastname ?? "",
						streetname: businessAddress?.streetname ?? "",
						addressAdd2: businessAddress?.addressAdd2 ?? "",
						countryCode: businessAddress?.countryCode ?? "",
						postCode: businessAddress?.postCode ?? "",
						city: businessAddress?.city ?? "",
						addressAdd1: businessAddress?.addressAdd1 ?? "",
						mobileNo: businessAddress?.mobileNo ?? "",
						email: businessAddress?.email ?? "",
					},
				},
			],
		}

		const result = await this.client.createShipment(shipmentRequest)

		return {
			data: {
				...((fulfillment?.data as object) || {}),
				...result,
			},
			labels: result.shipment_label ? [
				{
					tracking_number: result.shipment_number,
					tracking_url: "",
					label_url: result.shipment_label,
				}
			] : [],
		}
	}

	async cancelFulfillment(
		fulfillment: Record<string, unknown>
	): Promise<void> {
		// Mondial Relay does not support cancellation via API
		this.logger_.warn(
			"Mondial Relay does not support fulfillment cancellation via API"
		)
	}

	async getFulfillmentDocuments(
		data: Record<string, unknown>
	): Promise<never[]> {
		return []
	}

	async getReturnDocuments(
		data: Record<string, unknown>
	): Promise<never[]> {
		return []
	}

	async getShipmentDocuments(
		data: Record<string, unknown>
	): Promise<never[]> {
		return []
	}

	async retrieveDocuments(
		fulfillmentData: Record<string, unknown>,
		documentType: string
	): Promise<void> {
		// Not implemented
	}
}

export default MondialRelayFulfillmentService
