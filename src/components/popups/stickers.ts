/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import PopupElement from ".";
import appStickersManager from "../../lib/appManagers/appStickersManager";
import { RichTextProcessor } from "../../lib/richtextprocessor";
import Scrollable from "../scrollable";
import { wrapSticker } from "../wrappers";
import LazyLoadQueue from "../lazyLoadQueue";
import { putPreloader } from "../misc";
import animationIntersector from "../animationIntersector";
import { toggleDisability } from "../../helpers/dom";
import appImManager from "../../lib/appManagers/appImManager";
import { StickerSet } from "../../layer";
import mediaSizes from "../../helpers/mediaSizes";
import { i18n } from "../../lib/langPack";
import Button from "../button";
import findUpClassName from "../../helpers/dom/findUpClassName";

const ANIMATION_GROUP = 'STICKERS-POPUP';

export default class PopupStickers extends PopupElement {
  private stickersFooter: HTMLElement;
  private stickersDiv: HTMLElement;
  private h6: HTMLElement;

  private set: StickerSet.stickerSet;

  constructor(private stickerSetInput: {
    //_: 'inputStickerSetID',
    id: string,
    access_hash: string
  }) {
    super('popup-stickers', null, {closable: true, overlayClosable: true, body: true});

    this.h6 = document.createElement('h6');
    this.h6.append(i18n('Loading'));

    this.header.append(this.h6);

    this.onClose = () => {
      animationIntersector.setOnlyOnePlayableGroup('');
      this.stickersFooter.removeEventListener('click', this.onFooterClick);
      this.stickersDiv.removeEventListener('click', this.onStickersClick);
    };

    const div = document.createElement('div');
    div.classList.add('sticker-set');

    this.stickersDiv = document.createElement('div');
    this.stickersDiv.classList.add('sticker-set-stickers', 'is-loading');

    putPreloader(this.stickersDiv, true);

    this.stickersFooter = document.createElement('div');
    this.stickersFooter.classList.add('sticker-set-footer');

    div.append(this.stickersDiv);

    const btn = Button('btn-primary btn-primary-transparent disable-hover', {noRipple: true, text: 'Loading'});
    this.stickersFooter.append(btn);

    this.body.append(div);
    const scrollable = new Scrollable(this.body);
    this.body.append(this.stickersFooter);
    
    // const editButton = document.createElement('button');
    // editButton.classList.add('btn-primary');

    // this.stickersFooter.append(editButton);

    this.loadStickerSet();
  }

  onFooterClick = () => {
    const toggle = toggleDisability([this.stickersFooter], true);

    appStickersManager.toggleStickerSet(this.set).then(() => {
      this.hide();
    }).catch(() => {
      toggle();
    });
  };

  onStickersClick = (e: MouseEvent) => {
    const target = findUpClassName(e.target, 'sticker-set-sticker');
    if(!target) return;

    const fileId = target.dataset.docId;
    if(appImManager.chat.input.sendMessageWithDocument(fileId)) {
      this.hide();
    } else {
      console.warn('got no doc by id:', fileId);
    }
  };

  private loadStickerSet() {
    return appStickersManager.getStickerSet(this.stickerSetInput).then(set => {
      //console.log('PopupStickers loadStickerSet got set:', set);

      this.set = set.set;

      animationIntersector.setOnlyOnePlayableGroup(ANIMATION_GROUP);

      this.h6.innerHTML = RichTextProcessor.wrapEmojiText(set.set.title);
      this.stickersFooter.classList.toggle('add', !set.set.installed_date);

      let button: HTMLElement;
      if(set.set.installed_date) {
        button = Button('btn-primary btn-primary-transparent danger', {noRipple: true});
        button.append(i18n('RemoveStickersCount', [i18n('Stickers', [set.set.count])]));
      } else {
        button = Button('btn-primary btn-color-primary', {noRipple: true});
        button.append(i18n('AddStickersCount', [i18n('Stickers', [set.set.count])]));
      }

      this.stickersFooter.textContent = '';
      this.stickersFooter.append(button);

      button.addEventListener('click', this.onFooterClick);

      if(set.documents.length) {
        this.stickersDiv.addEventListener('click', this.onStickersClick);
      }

      const lazyLoadQueue = new LazyLoadQueue();
      
      this.stickersDiv.classList.remove('is-loading');
      this.stickersDiv.innerHTML = '';
      for(let doc of set.documents) {
        if(doc._ === 'documentEmpty') {
          continue;
        }
        
        const div = document.createElement('div');
        div.classList.add('sticker-set-sticker');

        const size = mediaSizes.active.esgSticker.width;
        
        wrapSticker({
          doc, 
          div, 
          lazyLoadQueue, 
          group: ANIMATION_GROUP, 
          play: true,
          loop: true,
          width: size,
          height: size
        });

        this.stickersDiv.append(div);
      }
    });
  }
}
