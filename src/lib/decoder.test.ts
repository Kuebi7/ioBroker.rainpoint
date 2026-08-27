/// <reference types="mocha" />
import { expect } from 'chai';
import { decodeSensor, decodeValve } from './decoder';
import { fahrenheitTenthsToCelsius, getDeviceKind, parseZoneNames, sanitizeId } from './devices';

describe('decoder', () => {
    it('decodes an ASCII two-zone valve payload', () => {
        const decoded = decodeValve('1,-84,1;1,9,0,0,0,0|0,1291,0,0,0,0');
        expect(decoded.hubOnline).to.equal(true);
        expect(decoded.zones.get(1)?.open).to.equal(true);
        expect(decoded.zones.get(1)?.durationSeconds).to.equal(540);
        expect(decoded.zones.get(2)?.open).to.equal(false);
    });

    it('decodes a hex TLV valve payload', () => {
        const decoded = decodeValve('10#18DC0119D80125AD5802');
        expect(decoded.hubOnline).to.equal(true);
        expect(decoded.zones.get(1)?.open).to.equal(true);
        expect(decoded.zones.get(1)?.durationSeconds).to.equal(600);
    });

    it('decodes ASCII soil moisture', () => {
        const decoded = decodeSensor('1,-73,1;766,52,G=31351', 'HCS021FRF');
        expect(decoded.temperature).to.equal(fahrenheitTenthsToCelsius(766));
        expect(decoded.moisture).to.equal(52);
        expect(decoded.illuminance).to.equal(3135.1);
        expect(decoded.rssi).to.equal(-73);
    });

    it('decodes ASCII rain totals', () => {
        const decoded = decodeSensor('1,0,1;R=270(10/20/270)', 'HCS012ARF');
        expect(decoded.rainTotalMm).to.equal(27);
        expect(decoded.rainHourMm).to.equal(1);
        expect(decoded.rainDailyMm).to.equal(2);
        expect(decoded.rainWeekMm).to.equal(27);
    });

    it('decodes a display hub payload', () => {
        const decoded = decodeSensor('1,-50,1;781(781/723/1),52(64/50/1),P=10213(10222/10205/1)', 'HWS019WRF-V2');
        expect(decoded.temperature).to.equal(fahrenheitTenthsToCelsius(781));
        expect(decoded.humidity).to.equal(52);
        expect(decoded.pressure).to.equal(10213);
    });
});

describe('devices', () => {
    it('maps model prefixes to kinds', () => {
        expect(getDeviceKind('HTV213FRF')).to.equal('valve');
        expect(getDeviceKind('HCS021FRF')).to.equal('sensor');
        expect(getDeviceKind('HWG023WBRF-V2')).to.equal('gateway');
        expect(getDeviceKind('HIS019WRF', true)).to.equal('gateway');
        expect(getDeviceKind('HIS019WRF', false)).to.equal('valve');
        expect(getDeviceKind('HWS019WRF-V2')).to.equal('hub');
    });

    it('parses zone names and sanitizes ids', () => {
        expect(parseZoneNames('Front|Back', 2)).to.deep.equal(['Front', 'Back']);
        expect(sanitizeId('abc/def')).to.equal('abc_def');
    });
});
