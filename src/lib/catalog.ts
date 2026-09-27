export type LessonCard = {
  n: string;
  title: string;
  free: boolean;
  thumb: string;
};

export const lessons: LessonCard[] = [
  { n: '01', title: 'Anthem Part Two: fast singles, slow then at tempo', free: true, thumb: '/img/gym/hand-speed.jpg' },
  { n: '02', title: 'Feeling This: fast 8ths and the half-time switch', free: false, thumb: '/img/gym/kit.jpg' },
  { n: '03', title: 'Travis fills: linear hand and foot patterns', free: false, thumb: '/img/gym/drummer.jpg' },
  { n: '04', title: 'Ghost notes that sit in the pocket', free: false, thumb: '/img/gym/snare.jpg' },
  { n: '05', title: 'Copeland-style independence, one limb at a time', free: false, thumb: '/img/gym/cymbals.jpg' },
  { n: '06', title: 'Gadd pocket: space, dynamics, and time', free: false, thumb: '/img/gym/practice.jpg' },
  { n: '07', title: 'Marching rudiments that transfer to the kit', free: false, thumb: '/img/gym/sticks.jpg' },
  { n: '08', title: 'Fills that serve the song', free: false, thumb: '/img/gym/live.jpg' },
];
