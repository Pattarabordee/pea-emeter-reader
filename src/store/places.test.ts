import { describe, it, expect } from 'vitest';
import { distanceM, normMac, parsePlaces } from './places';

const HEAD = '﻿office,serial,mac,equipment,maker,batch,gis_match,tag,route,feeder,code,phase,lat,lon';

describe('parsePlaces', () => {
  it('reads columns by name and skips rows with a bad MAC or a position outside Thailand', () => {
    const text = [HEAD,
      'pkn,6600000001,aa:bb:cc:dd:ee:01,1,IPOWER,R,1,t,1,F,D,1,17.39,103.76',
      'pkn,6600000002,bad,1,IPOWER,R,1,t,1,F,D,1,17.39,103.76',
      'pkn,6600000003,AA:BB:CC:DD:EE:03,1,K.Y.,R,0,t,1,F,D,3,0,0',
      ''].join('\r\n');
    expect(parsePlaces(text)).toEqual([{ mac: 'AA:BB:CC:DD:EE:01', serial: '6600000001', maker: 'IPOWER', phase: '1', office: 'pkn', lat: 17.39, lon: 103.76 }]);
  });

  it('refuses a file without mac/lat/lon columns', () => {
    expect(() => parsePlaces('name,mac,password,type\r\nA,AA:BB:CC:DD:EE:01,x,1')).toThrow('ไม่ใช่ไฟล์พิกัด');
  });
});

describe('distanceM / normMac', () => {
  it('is about 111 km per degree of latitude and 0 for the same point', () => {
    expect(distanceM(17, 103, 18, 103)).toBeCloseTo(111195, -2);
    expect(distanceM(17.4, 103.7, 17.4, 103.7)).toBe(0);
  });
  it('normalises MAC spelling', () => {
    expect(normMac('aa:bb-cc dd:ee:ff')).toBe('AABBCCDDEEFF');
  });
});
