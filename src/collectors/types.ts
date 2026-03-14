export interface CollectorInfo {
  id: string;
  name: string;
  platform: string;
  runtime: string;
  description: string;
  supportedEventTypes: string[];
  scriptPath?: string | undefined;
  sampleFixturePath?: string | undefined;
}
