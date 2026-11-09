import { Component } from '@angular/core';
const styles = `:host { display: block; width: min(100%, 280px); margin-inline: auto; color: var(--ion-color-primary); pointer-events: none; } svg { display: block; width: 100%; height: auto; transform: none; }`;
@Component({ selector: 'app-kaaba-art', templateUrl: '../../../public/assets/art/kaaba.svg', styles, host: { 'aria-hidden': 'true' } })
export class KaabaArtComponent {}
@Component({ selector: 'app-madinah-art', templateUrl: '../../../public/assets/art/madinah.svg', styles, host: { 'aria-hidden': 'true' } })
export class MadinahArtComponent {}
