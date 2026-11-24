interface ISiteMetadataResult {
  siteTitle: string;
  siteUrl: string;
  description: string;
  logo: string;
  navLinks: {
    name: string;
    url: string;
  }[];
}

const data: ISiteMetadataResult = {
  siteTitle: 'Suuu · 跑步档案',
  siteUrl: 'https://suuu.run',
  logo: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQTtc69JxHNcmN1ETpMUX4dozAgAN6iPjWalQ&usqp=CAU',
  description:
    'Suuu 的个人跑步档案，用轨迹记录每一次出发，用时间积累每一公里。',
  navLinks: [
    {
      name: 'Summary',
      url: `${import.meta.env.BASE_URL}summary`,
    },
    {
      name: 'Blog',
      url: 'https://github.com/SuuuBreak',
    },
    {
      name: 'About',
      url: 'https://github.com/SuuuBreak',
    },
  ],
};

export default data;
