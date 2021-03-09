import { fontFamily } from "../../components/middleEllipsis";
import { MOUNT_CLASS_TO } from "../../config/debug";
import { CancellablePromise, deferredPromise } from "../../helpers/cancellablePromise";
import { tsNow } from "../../helpers/date";
import { copy, deepEqual } from "../../helpers/object";
import { convertInputKeyToKey } from "../../helpers/string";
import { isMobile } from "../../helpers/userAgent";
import { InputNotifyPeer, InputPeerNotifySettings, NotifyPeer, PeerNotifySettings, Update } from "../../layer";
import Config from "../config";
import apiManager from "../mtproto/mtprotoworker";
import rootScope from "../rootScope";
import sessionStorage from "../sessionStorage";
import apiUpdatesManager from "./apiUpdatesManager";
import appChatsManager from "./appChatsManager";
import appPeersManager from "./appPeersManager";
import appStateManager from "./appStateManager";
import appUsersManager from "./appUsersManager";

type MyNotification = Notification & {
  hidden?: boolean,
  show?: () => void,
};

export type NotifyOptions = Partial<{
  tag: string;
  image: string;
  key: string;
  title: string;
  message: string;
  silent: boolean;
  onclick: () => void;
}>;

export class AppNotificationsManager {
  private notificationsUiSupport: boolean;
  private notificationsShown: {[key: string]: MyNotification} = {};
  private notificationIndex = 0;
  private notificationsCount = 0;
  private soundsPlayed: {[tag: string]: number} = {};
  private vibrateSupport = !!navigator.vibrate;
  private nextSoundAt: number;
  private prevSoundVolume: number;
  private peerSettings = {
    notifyPeer: {} as {[peerId: number]: Promise<PeerNotifySettings>},
    notifyUsers: null as Promise<PeerNotifySettings>,
    notifyChats: null as Promise<PeerNotifySettings>,
    notifyBroadcasts: null as Promise<PeerNotifySettings>
  };
  private exceptions: {[peerId: string]: PeerNotifySettings} = {};
  private notifyContactsSignUp: Promise<boolean>;
  private faviconEl: HTMLLinkElement = document.head.querySelector('link[rel="icon"]');
  private langNotificationsPluralize = 'notifications';//_.pluralize('page_title_pluralize_notifications');

  private titleBackup = document.title;
  private titleChanged = false;
  private titleInterval: number;
  private prevFavicon: string;
  private stopped = false;

  private settings: Partial<{
    nodesktop: boolean,
    volume: number,
    novibrate: boolean,
    nopreview: boolean,
    nopush: boolean,
    nosound: boolean,
  }> = {};

  private registeredDevice: any;
  private pushInited = false;

  private topMessagesDeferred: CancellablePromise<void>;

  private notifySoundEl: HTMLElement;

  constructor() {
    // @ts-ignore
    navigator.vibrate = navigator.vibrate || navigator.mozVibrate || navigator.webkitVibrate;

    this.notificationsUiSupport = ('Notification' in window) || ('mozNotification' in navigator);

    this.topMessagesDeferred = deferredPromise<void>();

    this.notifySoundEl = document.createElement('div');
    this.notifySoundEl.id = 'notify-sound';
    document.body.append(this.notifySoundEl);

    /* rootScope.on('idle.deactivated', (newVal) => {
      if(newVal) {
        stop();
      }
    });*/

    rootScope.on('idle', (newVal) => {
      if(this.stopped) {
        return;
      }

      if(!newVal) {
        this.clear();
      }

      this.toggleToggler();
    });

    rootScope.on('apiUpdate', (update) => {
      // console.log('on apiUpdate', update)
      switch(update._) {
        case 'updateNotifySettings': {
          this.savePeerSettings(update.peer._ === 'notifyPeer' ? appPeersManager.getPeerId(update.peer.peer) : update.peer._, update.notify_settings);
          rootScope.broadcast('notify_settings', update);
          break;
        }
      }
    });

    /* rootScope.on('push_init', (tokenData) => {
      this.pushInited = true
      if(!this.settings.nodesktop && !this.settings.nopush) {
        if(tokenData) {
          this.registerDevice(tokenData);
        } else {
          WebPushApiManager.subscribe();
        }
      } else {
        this.unregisterDevice(tokenData);
      }
    });
    rootScope.on('push_subscribe', (tokenData) => {
      this.registerDevice(tokenData);
    });
    rootScope.on('push_unsubscribe', (tokenData) => {
      this.unregisterDevice(tokenData);
    }); */

    rootScope.addListener('dialogs_multiupdate', () => {
      //unregisterTopMsgs()
      this.topMessagesDeferred.resolve();
    }, true);

    /* rootScope.on('push_notification_click', (notificationData) => {
      if(notificationData.action === 'push_settings') {
        this.topMessagesDeferred.then(() => {
          $modal.open({
            templateUrl: templateUrl('settings_modal'),
            controller: 'SettingsModalController',
            windowClass: 'settings_modal_window mobile_modal',
            backdrop: 'single'
          })
        });
        return;
      }

      if(notificationData.action === 'mute1d') {
        apiManager.invokeApi('account.updateDeviceLocked', {
          period: 86400
        }).then(() => {
          // var toastData = toaster.pop({
          //   type: 'info',
          //   body: _('push_action_mute1d_success'),
          //   bodyOutputType: 'trustedHtml',
          //   clickHandler: () => {
          //     toaster.clear(toastData)
          //   },
          //   showCloseButton: false
          // })
        });

        return;
      }

      const peerId = notificationData.custom && notificationData.custom.peerId;
      console.log('click', notificationData, peerId);
      if(peerId) {
        this.topMessagesDeferred.then(() => {
          if(notificationData.custom.channel_id &&
              !appChatsManager.hasChat(notificationData.custom.channel_id)) {
            return;
          }

          if(peerId > 0 && !appUsersManager.hasUser(peerId)) {
            return;
          }

          // rootScope.broadcast('history_focus', {
          //   peerString: appPeersManager.getPeerString(peerId)
          // });
        });
      }
    }); */
  }

  private toggleToggler(enable = rootScope.idle.isIDLE) {
    if(isMobile) return;

    const resetTitle = () => {
      this.titleChanged = false;
      document.title = this.titleBackup;
      this.setFavicon();
    };

    window.clearInterval(this.titleInterval);
    this.titleInterval = 0;

    if(!enable) {
      resetTitle();
    } else {
      this.titleInterval = window.setInterval(() => {
        if(!this.notificationsCount) {
          this.toggleToggler(false);
        } else if(this.titleChanged) {
          resetTitle();
        } else {
          this.titleChanged = true;
          document.title = this.notificationsCount + ' ' + this.langNotificationsPluralize;
          //this.setFavicon('assets/img/favicon_unread.ico');

          // fetch('assets/img/favicon.ico')
          // .then(res => res.blob())
          // .then(blob => {
            // const img = document.createElement('img');
            // img.src = URL.createObjectURL(blob);

            const canvas = document.createElement('canvas');
            canvas.width = 32 * window.devicePixelRatio;
            canvas.height = canvas.width;
  
            const ctx = canvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, 2 * Math.PI, false);
            ctx.fillStyle = '#5b8af1';
            ctx.fill();

            let fontSize = 24;
            let str = '' + this.notificationsCount;
            if(this.notificationsCount < 10) {
              fontSize = 22;
            } else if(this.notificationsCount < 100) {
              fontSize = 20;
            } else {
              str = '99+';
              fontSize = 18;
            }
            
            ctx.font = `700 ${fontSize}px ${fontFamily}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'white';
            ctx.fillText('' + this.notificationsCount, canvas.width / 2, canvas.height * .5625);

            /* const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height); */
  
            this.setFavicon(canvas.toDataURL());
          // });
        }
      }, 1000);
    }
  }

  public updateLocalSettings() {
    Promise.all(['notify_nodesktop', 'notify_volume', 'notify_novibrate', 'notify_nopreview', 'notify_nopush'].map(k => sessionStorage.get(k as any)))
    .then((updSettings) => {
      this.settings.nodesktop = updSettings[0];
      this.settings.volume = updSettings[1] === undefined ? 0.5 : updSettings[1];
      this.settings.novibrate = updSettings[2];
      this.settings.nopreview = updSettings[3];
      this.settings.nopush = updSettings[4];

      /* if(this.pushInited) {
        const needPush = !this.settings.nopush && !this.settings.nodesktop && WebPushApiManager.isAvailable || false;
        const hasPush = this.registeredDevice !== false;
        if(needPush !== hasPush) {
          if(needPush) {
            WebPushApiManager.subscribe();
          } else {
            WebPushApiManager.unsubscribe();
          }
        }
      }

      WebPushApiManager.setSettings(this.settings); */
    });

    appStateManager.getState().then(state => {
      this.settings.nosound = !state.settings.notifications.sound;
    });
  }

  public getLocalSettings() {
    return this.settings;
  }

  public getNotifySettings(peer: InputNotifyPeer): Promise<PeerNotifySettings> {
    let key: any = convertInputKeyToKey(peer._);
    let obj: any = this.peerSettings[key as NotifyPeer['_']];

    if(peer._ === 'inputNotifyPeer') {
      key = appPeersManager.getPeerId(peer.peer);
      obj = obj[key];
    }

    if(obj) {
      return obj;
    }

    return (obj || this.peerSettings)[key] = apiManager.invokeApi('account.getNotifySettings', {peer})/* .then(settings => {
      return settings;
    }) */;
  }

  public updateNotifySettings(peer: InputNotifyPeer, settings: InputPeerNotifySettings) {
    //this.savePeerSettings(peerId, settings);

    /* const inputSettings: InputPeerNotifySettings = copy(settings) as any;
    inputSettings._ = 'inputPeerNotifySettings'; */

    return apiManager.invokeApi('account.updateNotifySettings', {
      peer,
      settings
    }).then(value => {
      if(value) {
        apiUpdatesManager.processUpdateMessage({
          _: 'updateShort',
          update: {
            _: 'updateNotifySettings', 
            peer: {
              ...peer,
              _: convertInputKeyToKey(peer._)
            }, 
            notify_settings: { // ! WOW, IT WORKS !
              ...settings,
              _: 'peerNotifySettings',
            }
          } as Update.updateNotifySettings
        });
      }
    });
  }

  public getNotifyExceptions() {
    apiManager.invokeApi('account.getNotifyExceptions', {compare_sound: true})
    .then((updates) => {
      apiUpdatesManager.processUpdateMessage(updates);
    });
  }

  public getContactSignUpNotification() {
    if(this.notifyContactsSignUp) return this.notifyContactsSignUp;
    return this.notifyContactsSignUp = apiManager.invokeApi('account.getContactSignUpNotification');
  }

  public setContactSignUpNotification(silent: boolean) {
    apiManager.invokeApi('account.setContactSignUpNotification', {silent})
    .then(value => {
      this.notifyContactsSignUp = Promise.resolve(!silent);
    });
  }

  private setFavicon(href: string = 'assets/img/favicon.ico') {
    if(this.prevFavicon === href) {
      return;
    }

    const link = this.faviconEl.cloneNode() as HTMLLinkElement;
    link.href = href;
    this.faviconEl.parentNode.replaceChild(link, this.faviconEl);
    this.faviconEl = link;

    this.prevFavicon = href;
  }

  public savePeerSettings(key: number | NotifyPeer['_'], settings: PeerNotifySettings) {
    const p = Promise.resolve(settings);
    let obj: any;
    if(typeof(key) === 'number') {
      obj = this.peerSettings['notifyPeer'];
    }
    
    (obj || this.peerSettings)[key] = p;

    //rootScope.broadcast('notify_settings', {peerId: peerId});
  }

  public isMuted(peerNotifySettings: PeerNotifySettings) {
    return peerNotifySettings._ === 'peerNotifySettings' &&
      (peerNotifySettings.mute_until * 1000) > tsNow();
  }

  public getPeerMuted(peerId: number) {
    return this.getNotifySettings({_: 'inputNotifyPeer', peer: appPeersManager.getInputPeerById(peerId)})
    .then((peerNotifySettings) => this.isMuted(peerNotifySettings));
  }

  public start() {
    this.updateLocalSettings();
    //rootScope.on('settings_changed', this.updateNotifySettings);
    //WebPushApiManager.start();

    if(!this.notificationsUiSupport) {
      return false;
    }

    if('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      window.addEventListener('click', this.requestPermission);
    }

    try {
      if('onbeforeunload' in window) {
        window.addEventListener('beforeunload', this.clear);
      }
    } catch (e) {}
  }

  private stop() {
    this.clear();
    window.clearInterval(this.titleInterval);
    this.titleInterval = 0;
    this.setFavicon();
    this.stopped = true;
  }

  private requestPermission = () => {
    Notification.requestPermission();
    window.removeEventListener('click', this.requestPermission);
  };

  public notify(data: NotifyOptions) {
    console.log('notify', data, rootScope.idle.isIDLE, this.notificationsUiSupport, this.stopped);
    if(this.stopped) {
      return;
    }

    // FFOS Notification blob src bug workaround
    /* if(Config.Navigator.ffos && !Config.Navigator.ffos2p) {
      data.image = 'https://telegram.org/img/t_logo.png'
    }
    else if (data.image && !angular.isString(data.image)) {
      if (Config.Navigator.ffos2p) {
        FileManager.getDataUrl(data.image, 'image/jpeg').then(function (url) {
          data.image = url
          notify(data)
        })
        return false
      } else {
        data.image = FileManager.getUrl(data.image, 'image/jpeg')
      }
    }
    else if (!data.image) */ {
      data.image = 'assets/img/logo.svg';
    }
    // console.log('notify image', data.image)

    this.notificationsCount++;
    if(!this.titleInterval) {
      this.toggleToggler();
    }

    const now = tsNow();
    if(this.settings.volume > 0 && !this.settings.nosound/* &&
      (
        !data.tag ||
        !this.soundsPlayed[data.tag] ||
        now > this.soundsPlayed[data.tag] + 60000
      ) */
    ) {
      this.testSound(this.settings.volume);
      this.soundsPlayed[data.tag] = now;
    }

    if(!this.notificationsUiSupport ||
      'Notification' in window && Notification.permission !== 'granted') {
      return false;
    }

    if(this.settings.nodesktop) {
      if(this.vibrateSupport && !this.settings.novibrate) {
        navigator.vibrate([200, 100, 200]);
        return;
      }

      return;
    }

    const idx = ++this.notificationIndex;
    const key = data.key || 'k' + idx;
    let notification: MyNotification;

    if('Notification' in window) {
      try {
        if(data.tag) {
          for(let i in this.notificationsShown) {
            const notification = this.notificationsShown[i];
            if(notification &&
                notification.tag === data.tag) {
              notification.hidden = true
            }
          }
        }

        notification = new Notification(data.title, {
          icon: data.image || '',
          body: data.message || '',
          tag: data.tag || '',
          silent: data.silent || false
        });
      } catch(e) {
        this.notificationsUiSupport = false;
        //WebPushApiManager.setLocalNotificationsDisabled();
        return
      }
    } /* else if('mozNotification' in navigator) {
      notification = navigator.mozNotification.createNotification(data.title, data.message || '', data.image || '')
    } else if(notificationsMsSiteMode) {
      window.external.msSiteModeClearIconOverlay()
      window.external.msSiteModeSetIconOverlay('img/icons/icon16.png', data.title)
      window.external.msSiteModeActivate()
      notification = {
        index: idx
      }
    } */ else {
      return;
    }

    notification.onclick = () => {
      notification.close();
      //AppRuntimeManager.focus();
      this.clear();
      if(data.onclick) {
        data.onclick();
      }
    };

    notification.onclose = () => {
      if(!notification.hidden) {
        delete this.notificationsShown[key];
        this.clear();
      }
    };

    if(notification.show) {
      notification.show();
    }
    this.notificationsShown[key] = notification;

    if(!isMobile) {
      setTimeout(() => {
        this.hide(key);
      }, 8000);
    }
  }

  public testSound(volume: number) {
    const now = tsNow();
    if(this.nextSoundAt && now < this.nextSoundAt && this.prevSoundVolume === volume) {
      return;
    }

    this.nextSoundAt = now + 1000;
    this.prevSoundVolume = volume;
    const filename = 'assets/audio/notification.mp3';
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('mozaudiochannel', 'notification');
    audio.volume = volume;
    audio.innerHTML = `
      <source src="${filename}" type="audio/mpeg" />
      <embed hidden="true" autostart="true" loop="false" volume="${volume * 100}" src="${filename}" />
    `;
    this.notifySoundEl.append(audio);

    audio.addEventListener('ended', () => {
      audio.remove();
    }, {once: true});
  }

  public cancel(key: string) {
    const notification = this.notificationsShown[key];
    if(notification) {
      if(this.notificationsCount > 0) {
        this.notificationsCount--;
      }

      try {
        if(notification.close) {
          notification.hidden = true;
          notification.close();
        }/*  else if(notificationsMsSiteMode &&
          notification.index === notificationIndex) {
          window.external.msSiteModeClearIconOverlay()
        } */
      } catch (e) {}

      delete this.notificationsShown[key];
    }
  }

  private hide(key: string) {
    const notification = this.notificationsShown[key];
    if(notification) {
      try {
        if(notification.close) {
          notification.hidden = true;
          notification.close();
        }
      } catch (e) {}
    }
  }

  public soundReset(tag: string) {
    delete this.soundsPlayed[tag];
  }

  public clear() {
    /* if(notificationsMsSiteMode) {
      window.external.msSiteModeClearIconOverlay()
    } else { */
      for(let i in this.notificationsShown) {
        const notification = this.notificationsShown[i];
        try {
          if(notification.close) {
            notification.close();
          }
        } catch (e) {}
      }
    /* } */
    this.notificationsShown = {};
    this.notificationsCount = 0;

    //WebPushApiManager.hidePushNotifications();
  }

  private registerDevice(tokenData: any) {
    if(this.registeredDevice &&
        deepEqual(this.registeredDevice, tokenData)) {
      return false;
    }

    apiManager.invokeApi('account.registerDevice', {
      token_type: tokenData.tokenType,
      token: tokenData.tokenValue,
      other_uids: [],
      app_sandbox: false,
      secret: new Uint8Array()
    }).then(() => {
      this.registeredDevice = tokenData;
    }, (error) => {
      error.handled = true;
    })
  }

  private unregisterDevice(tokenData: any) {
    if(!this.registeredDevice) {
      return false;
    }

    apiManager.invokeApi('account.unregisterDevice', {
      token_type: tokenData.tokenType,
      token: tokenData.tokenValue,
      other_uids: []
    }).then(() => {
      this.registeredDevice = false
    }, (error) => {
      error.handled = true
    })
  }

  public getVibrateSupport() {
    return this.vibrateSupport
  }
}

const appNotificationsManager = new AppNotificationsManager();
MOUNT_CLASS_TO && (MOUNT_CLASS_TO.appNotificationsManager = appNotificationsManager);
export default appNotificationsManager;