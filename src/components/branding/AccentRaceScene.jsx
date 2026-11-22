import React, { useId } from 'react';

const accent = opacity => `rgb(var(--system-accent-rgb, 99 102 241) / ${opacity})`;

const laneLines = [
    'M170 753c6-88 257-149 669-175 391-24 656 38 645 131-11 96-303 196-693 222-357 24-631-33-621-178Z',
    'M207 751c8-83 248-143 632-168 371-25 624 34 614 126-11 89-290 182-655 208-337 24-600-32-591-166Z',
    'M245 749c8-80 236-136 598-161 350-24 588 30 578 119-10 83-270 169-611 195-316 24-574-31-565-153Z',
    'M284 747c8-76 226-132 561-153 325-21 554 25 543 111-11 76-250 155-556 181-300 26-556-28-548-139Z',
    'M326 745c9-72 207-123 522-146 304-22 517 24 507 105-9 69-229 140-523 165-274 24-513-26-506-124Z',
    'M368 742c7-68 198-113 484-136 282-22 484 27 473 97-10 63-214 125-488 150-244 22-475-25-469-111Z'
];

export default function AccentRaceScene({ className = '', dark = false }) {
    const id = useId();
    const paint = name => `url(#${id}-${name})`;
    const draw = dark ? {
        sky: '#0e1629', horizon: '#29354e', far: '#253650', ridge: '#192942',
        land: '#202f48', field: '#233451', fieldEdge: '#426081', outline: '#536a8d', ink: '#bbcbe0',
        foundation: '#20344f', glass: '#324866', glassShade: '#1d304c', roof: '#7c94b6', roofShade: '#3e5677',
        line: '#c5d5ed', rail: '#6483ab', marking: '#d8e4f4', pin: '#d1e1f4'
    } : {
        sky: '#e9eff7', horizon: '#f8fafd', far: '#d1ddeb', ridge: '#bbcce0',
        land: '#d0dceb', field: '#c4d4e8', fieldEdge: '#a0b6d1', outline: '#98b1cf', ink: '#516b8d',
        foundation: '#9ab1d0', glass: '#b4cbe6', glassShade: '#8eaacd', roof: '#f5f8ff', roofShade: '#8aa5c8',
        line: '#f4f8ff', rail: '#6281a9', marking: '#f8fbff', pin: '#657f9e'
    };

    return (
        <svg className={className} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={`${id}-sky`} x2="0" y2="1">
                    <stop stopColor={draw.sky}/>
                    <stop offset=".65" stopColor={draw.horizon}/>
                    <stop offset="1" stopColor={draw.land}/>
                </linearGradient>
                <radialGradient id={`${id}-glow`} cx=".58" cy=".53" r=".61" gradientTransform="translate(0 .17) scale(1 .67)">
                    <stop stopColor={accent(dark ? .29 : .20)}/>
                    <stop offset="1" stopColor={accent(0)}/>
                </radialGradient>
                <linearGradient id={`${id}-ground`} x1="0" y1=".12" x2=".76" y2="1">
                    <stop stopColor={draw.land}/>
                    <stop offset=".56" stopColor={accent(dark ? .27 : .23)}/>
                    <stop offset="1" stopColor={accent(dark ? .39 : .34)}/>
                </linearGradient>
                <linearGradient id={`${id}-track`} x1=".03" y1="0" x2=".68" y2="1">
                    <stop stopColor={accent(dark ? .34 : .36)}/>
                    <stop offset=".58" stopColor={accent(dark ? .48 : .49)}/>
                    <stop offset="1" stopColor={accent(dark ? .72 : .58)}/>
                </linearGradient>
                <linearGradient id={`${id}-glass`} x2=".14" y2="1">
                    <stop stopColor={draw.glass}/>
                    <stop offset="1" stopColor={draw.glassShade}/>
                </linearGradient>
                <linearGradient id={`${id}-canopy`} x2=".07" y2="1">
                    <stop stopColor={draw.roof}/>
                    <stop offset="1" stopColor={draw.roofShade}/>
                </linearGradient>
                <path id={`${id}-outer-ring`} d="M130 755c6-96 269-158 710-184 414-24 678 43 669 138-10 103-315 212-717 239-374 25-673-29-662-193Z"/>
                <path id={`${id}-infield`} d="M407 739c8-64 182-108 446-130 260-21 450 28 440 93-10 56-199 113-453 135-218 19-438-24-433-98Z"/>
            </defs>

            <path d="M0 0h1600v900H0z" fill={paint('sky')}/>
            <path d="M0 0h1600v900H0z" fill={paint('glow')}/>
            <path d="M0 564c174-16 237-91 373-79 95 8 157 54 277 51 106-3 138-64 241-66 127-3 198 68 310 56 99-11 187-72 269-49 54 15 89 32 130 38v150H0Z" fill={draw.far} fillOpacity={dark ? '.58' : '.64'}/>
            <path d="M0 583c116-17 207-55 323-44 111 11 182 54 297 50 113-4 189-61 267-55 160 13 212 59 350 28 153-35 257-54 363-12v148H0Z" fill={draw.ridge} fillOpacity=".75"/>
            <path d="M0 642c223-53 356-3 580-17 167-10 236-53 392-51 190 2 417 67 628 12v314H0Z" fill={draw.land}/>
            <path d="M0 642c223-53 356-3 580-17 167-10 236-53 392-51 190 2 417 67 628 12v314H0Z" fill={paint('ground')}/>
            <g fill="none" stroke={draw.outline} strokeWidth="1.4" strokeOpacity={dark ? '.54' : '.46'} strokeLinecap="round">
                <path d="M0 610c121-23 235-32 333-9 70 16 158 32 249 17M1340 594c91 10 177 5 260-17"/>
                <path d="M0 699c118-29 206-25 277-16M0 717c80-19 129-20 180-18M1394 596l105-10 101-19"/>
            </g>

            <use href={`#${id}-outer-ring`} fill={draw.fieldEdge} stroke={draw.outline} strokeOpacity=".5" strokeWidth="9"/>
            <use href={`#${id}-outer-ring`} fill={paint('track')}/>
            <g fill="none" stroke={draw.line} strokeWidth="1.55" strokeOpacity={dark ? '.54' : '.83'}>
                {laneLines.map(path => <path key={path} d={path}/>)}
            </g>
            <use href={`#${id}-infield`} fill={draw.field} stroke={draw.line} strokeOpacity=".78" strokeWidth="2.5"/>
            <path d="M574 751c27-38 121-70 285-82 149-11 287 16 282 54-6 46-147 87-298 93-154 8-288-24-269-65Z" fill={accent(dark ? .18 : .16)}/>
            <g fill="none" stroke={draw.rail} strokeWidth="1.4" strokeOpacity={dark ? '.58' : '.43'}>
                <path d="M648 755c0-27 95-56 192-62 111-7 204 4 216 30 12 29-75 60-180 66-115 6-228-11-228-34Z"/>
                <path d="m693 727 333 23m-186-58 31 97"/>
            </g>

            <g>
                <path d="M601 630 641 573l344-19 104 57-78 30-343 9Z" fill={draw.foundation}/>
                <path d="m654 572 35-30 304-10 76 62-79 26-336 13Z" fill={paint('glass')}/>
                <path d="m982 567 82 21 5 8-79 24Z" fill={draw.glassShade}/>
                <path d="m654 605 338-21 1 23-339 23Z" fill={accent(dark ? .39 : .33)}/>
                <g stroke={draw.line} strokeWidth="2" strokeOpacity=".48">
                    <path d="M682 567v61m25-64v62m25-64v61m25-63v61m25-61v59m25-59v57m25-57v56m25-55v53m25-51v49m25-46v44m25-41v39m25-36v34m25-30v28"/>
                </g>
                <path d="M589 566c96-30 199-60 281-73 68-10 115-1 162 21l62 37-92 29c-141-22-279-19-413-14Z" fill={paint('canopy')}/>
                <path d="M589 566c156-5 286-7 413 14l92-29-7 19-86 27c-149-25-265-18-390-12Z" fill={draw.roofShade}/>
                <path d="M641 552c103-28 173-47 230-54 56-8 100-2 142 14l40 19c-121-19-279-6-412 21Z" fill={draw.roof} fillOpacity=".72"/>
                <path d="M612 577c136-8 290-8 389 15l81-25" fill="none" stroke={accent(dark ? .92 : .68)} strokeWidth="3" strokeLinecap="round"/>
                <path d="m643 598 345-14 2 7-348 16Z" fill={draw.line} fillOpacity=".69"/>
                <path d="m735 640 196-12 58 10-52 12-212 5Z" fill={draw.foundation}/>
                <path d="m726 654 211-6 49-10m-210 26 137-5" fill="none" stroke={draw.line} strokeOpacity=".61" strokeWidth="2"/>
            </g>

            <g fill="none" stroke={draw.rail} strokeOpacity=".72" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M85 607h86l54-36h44l23-19h49m927 20 34-24h54l41-30h49m-1446 297 62-15h59l34-14h36m1151 46h53l49-28 129-14"/>
                <path d="M881 493v-30l18-13m-230 93v-30l-25-15m395 46 22-30v-22"/>
            </g>
            <g fill={draw.pin} stroke={accent(dark ? .91 : .76)} strokeWidth="2">
                <circle cx="85" cy="607" r="4"/><circle cx="341" cy="552" r="4.5"/>
                <circle cx="1446" cy="518" r="4.5"/><circle cx="1342" cy="832" r="4.1"/>
                <circle cx="191" cy="786" r="4.3"/><circle cx="899" cy="450" r="4.2"/>
                <circle cx="644" cy="498" r="4.1"/><circle cx="1061" cy="492" r="4.2"/>
            </g>
            <g fill="none" stroke={draw.marking} strokeWidth="3" strokeOpacity={dark ? '.73' : '.81'}>
                <path d="m418 813-173 61m182-55-174 64m904-145 172 22m-183-14 174 23"/>
                <path d="m404 818 10 7m-40 3 14 7m-43 5 13 7m-42 4 13 7m-37 2 11 8m859-125 8 7m25-3 9 7m26-3 9 7m25-3 10 7m25-3 10 7"/>
            </g>
            <path d="M0 877c71-7 145 9 200 23H0Zm1453 23c52-22 94-30 147-33v33Z" fill={draw.ridge} fillOpacity=".75"/>
        </svg>
    );
}
