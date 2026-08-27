declare global {
	namespace ioBroker {
		interface AdapterConfig {
			appType: "rainpoint" | "homgar";
			email: string;
			password: string;
			areaCode: string;
			region: string;
			homeIndex: number;
			pollInterval: number;
			defaultDuration: number;
		}
	}
}

export {};
